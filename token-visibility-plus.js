/**
 * TokenVisibility+ Modul für Foundry VTT v14
 * Steuert die selektive Sichtbarkeit sauber über das Sichtsystem (Detection Modes).
 */

Hooks.once("init", () => {
  console.log("TokenVisibility+ | Initialisiere Modul...");

  // WIR LINKEN UNS IN DAS SICHTSYSTEM EIN
  // Foundry v14 nutzt DetectionModes, um zu prüfen, ob ein Token einen anderen sieht.
  // Hier überschreiben wir die Test-Sichtbarkeit für die Render-Pipeline.
  const originalTestVisibility = CanvasVisibility.prototype.testVisibility;
  
  CanvasVisibility.prototype.testVisibility = function(point, options={}) {
    const result = originalTestVisibility.call(this, point, options);
    
    // Falls der Core (Wände, Licht, Dunkelsicht) den Token ohnehin nicht sieht, bleibt er unsichtbar
    if (!result) return false;

    // Wir prüfen das spezifische Token-Objekt
    const object = options.object;
    if ( !(object instanceof Token) ) return result;

    // GMs übergehen alle Modul-Filter
    if (game.user.isGM) return true;

    // Modul-Flags auslesen
    const exceptions = object.document.getFlag("token-visibility-plus", "exceptions") || [];
    const isExcepted = exceptions.includes(game.user.id);
    const isGlobalHidden = object.document.getFlag("token-visibility-plus", "globalHidden") || false;

    // Unsere Logik-Matrix:
    if (isGlobalHidden) {
      // Wenn "Alle: UNSICHTBAR", sehen ihn NUR die Ausnahmen
      return isExcepted;
    } else {
      // Wenn "Alle: SICHTBAR", sehen ihn Ausnahmen NICHT (Halluzination)
      return !isExcepted;
    }
  };
});

let tvpMenuIsOpen = false;

Hooks.on("renderTokenHUD", (app, html, data) => {
  if (!game.user.isGM) return;

  const htmlElement = html.element instanceof HTMLElement ? html.element : (html instanceof HTMLElement ? html : html[0]);
  if (!htmlElement) return;

  const coreVisibilityButton = htmlElement.querySelector('.control-icon[data-action="visibility"]');
  if (!coreVisibilityButton) return;

  // DIE SICHRE KLICK-WEICHE FÜR DAS MENÜ
  const blockCoreToggle = (event) => {
    if (event.target.closest(".tvp-menu-list-items")) {
      event.stopPropagation();
      return;
    }

    if (event.target.closest(".tvp-header-toggle")) {
      return;
    }
    
    event.stopPropagation();
    event.preventDefault();

    const menu = coreVisibilityButton.querySelector(".tvp-menu-container");
    if (menu) {
      const isHidden = menu.classList.toggle("hidden");
      tvpMenuIsOpen = !isHidden;
      coreVisibilityButton.classList.toggle("active", tvpMenuIsOpen);
    }
  };

  coreVisibilityButton.removeEventListener("click", blockCoreToggle, true);
  coreVisibilityButton.addEventListener("click", blockCoreToggle, true);

  // WIR LESEN UNSER EIGENES FLAG AUS (Core hidden bleibt immer false!)
  const isGlobalHidden = app.object.document.getFlag("token-visibility-plus", "globalHidden") || false;
  const eyeIconClass = isGlobalHidden ? "fa-eye-slash" : "fa-eye";
  const eyeText = isGlobalHidden ? "Alle: UNSICHTBAR" : "Alle: SICHTBAR";
  
  // Synchronisiere das Icon des Core-Buttons visuell
  const icon = coreVisibilityButton.querySelector("i");
  if (icon) {
    icon.className = `fas ${eyeIconClass}`;
  }
  // Visueller Status des Core-Buttons spiegeln
  coreVisibilityButton.classList.toggle("opacity-50", isGlobalHidden);

  const oldMenu = coreVisibilityButton.querySelector(".tvp-menu-container");
  if (oldMenu) oldMenu.remove();

  const hiddenClass = tvpMenuIsOpen ? "" : "hidden";
  const menuContainer = document.createElement("div");
  menuContainer.className = `tvp-menu-container ${hiddenClass}`;
  menuContainer.innerHTML = `
    <ul class="tvp-menu-list">
      <li class="tvp-header-toggle" style="cursor:pointer; color:#ffb443; font-weight:bold; margin-bottom:8px; border-bottom:1px solid #7a7975; padding-bottom:4px;">
        <i class="fas ${eyeIconClass}"></i> ${eyeText}
      </li>
      <div class="tvp-menu-list-items">
        <li class="tvp-header" style="font-size:11px; text-transform:uppercase; color:#aaa; margin-bottom: 4px;">außer:</li>
      </div>
    </ul>
  `;

  // Finde alle Spieler auf der Szene
  const activeScUsers = game.users.filter(u => {
    if (u.isGM) return false;
    const char = u.character;
    if (!char) return false;
    return canvas.scene.tokens.some(t => t.actorId === char.id);
  });

  const listItemsContainer = menuContainer.querySelector(".tvp-menu-list-items");

  if (activeScUsers.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.classList.add("tvp-empty");
    emptyLi.innerText = "Keine SC-Spieler online";
    listItemsContainer.appendChild(emptyLi);
  } else {
    const currentExceptions = app.object.document.getFlag("token-visibility-plus", "exceptions") || [];

    activeScUsers.forEach(user => {
      const isChecked = currentExceptions.includes(user.id) ? "checked" : "";
      const item = document.createElement("li");
      item.className = "tvp-user-row";
      item.innerHTML = `
        <label style="width:100%; display:flex; align-items:center; cursor:pointer;">
          <input type="checkbox" class="tvp-user-checkbox" data-user-id="${user.id}" ${isChecked}>
          <span class="tvp-username">${user.name} (${user.character.name})</span>
        </label>
      `;
      listItemsContainer.appendChild(item);
    });
  }

  coreVisibilityButton.appendChild(menuContainer);
  if (tvpMenuIsOpen) coreVisibilityButton.classList.add("active");

  // KLICK AUF DIE OBERE "ALLE"-ZEILE (Steuert unser Flag)
  const toggleHeader = menuContainer.querySelector(".tvp-header-toggle");
  toggleHeader.addEventListener("click", async (event) => {
    event.stopPropagation();
    event.preventDefault();
    
    const tokenDocument = app.object.document;
    const newHiddenState = !isGlobalHidden;
    
    // Core-Auge bleibt auf sichtbar, damit Daten gestreamt werden!
    await tokenDocument.update({ hidden: false });
    await tokenDocument.setFlag("token-visibility-plus", "globalHidden", newHiddenState);
    
    app.render(true);
    canvas.perception.initialize();
  });

  // Schutz für die Spielerzeilen
  menuContainer.querySelectorAll(".tvp-user-row").forEach(row => {
    row.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

  // Event-Handler für die Checkboxen
  menuContainer.querySelectorAll(".tvp-user-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", async (event) => {
      event.stopPropagation();
      
      const cb = event.currentTarget;
      const userId = cb.dataset.userId;
      const tokenDocument = app.object.document;
      
      let exceptions = tokenDocument.getFlag("token-visibility-plus", "exceptions") || [];

      if (cb.checked) {
        if (!exceptions.includes(userId)) exceptions.push(userId);
      } else {
        exceptions = exceptions.filter(id => id !== userId);
      }

      await tokenDocument.setFlag("token-visibility-plus", "exceptions", exceptions);
      
      app.render(true);
      canvas.perception.initialize();
    });
  });
});

Hooks.on("closeTokenHUD", () => {
  tvpMenuIsOpen = false;
});