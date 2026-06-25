/**
 * TokenVisibility+ Modul für Foundry VTT v14
 * Radikale Lichtquellen-Zerstörung, Sicht-Filterung und intelligentes GM-Status-Overlay (Rot/Orange & Alpha-Steuerung).
 */

const TVP_EYE_ICON = "icons/svg/eye.svg";

// Hilfsfunktion: Prüft, ob ein Token für einen bestimmten User sichtbar sein sollte
function checkTvpVisibility(tokenDoc, userId) {
  if (!tokenDoc) return true;
  const exceptions = tokenDoc.getFlag("token-visibility-plus", "exceptions") || [];
  const isExcepted = exceptions.includes(userId);
  const isGlobalHidden = tokenDoc.getFlag("token-visibility-plus", "globalHidden") || false;

  if (isGlobalHidden) {
    return isExcepted; // Wenn "Alle: UNSICHTBAR", sehen ihn NUR die Ausnahmen
  } else {
    return !isExcepted; // Wenn "Alle: SICHTBAR", sehen ihn Ausnahmen NICHT
  }
}

// Hilfsfunktion: Berechnet die reine GM-Transparenz (Alpha)
function getGmAlpha(tokenDoc) {
  const isGlobalHidden = tokenDoc.getFlag("token-visibility-plus", "globalHidden") || false;
  const exceptions = tokenDoc.getFlag("token-visibility-plus", "exceptions") || [];

  // Verbesserung 2: Wenn global Sichtbar, aber Ausnahmen aktiv -> KEINE Transparenz (1.0)
  if (!isGlobalHidden && exceptions.length > 0) {
    return 1.0;
  }
  
  // Wenn global Unsichtbar (egal ob mit oder ohne Ausnahmen) -> 35% Transparenz
  if (isGlobalHidden) {
    return 0.35;
  }
  
  return 1.0;
}

// Hilfsfunktion: Zeichnet oder löscht das PIXI-Sprite und steuert die Farbe (Nur GM!)
function updateGmIcon(token) {
  if (!token || !game.user.isGM) return;

  const tokenDoc = token.document;
  const isGlobalHidden = tokenDoc.getFlag("token-visibility-plus", "globalHidden") || false;
  const exceptions = tokenDoc.getFlag("token-visibility-plus", "exceptions") || [];

  const isZustandA = isGlobalHidden && exceptions.length === 0;
  const isZustandB_Hidden = isGlobalHidden && exceptions.length > 0;
  const isZustandB_Visible = !isGlobalHidden && exceptions.length > 0;

  // Ein Icon wird benötigt, wenn irgendeine Art von Ausnahme/Spezialregel (Zustand B) aktiv ist
  const shouldHaveIcon = isZustandB_Hidden || isZustandB_Visible;

  let tvpSprite = token.getChildByName("tvpEyeIcon");

  if (shouldHaveIcon) {
    if (!tvpSprite) {
      tvpSprite = PIXI.Sprite.from(TVP_EYE_ICON);
      tvpSprite.name = "tvpEyeIcon";
      tvpSprite.anchor.set(0.5);
      tvpSprite.width = token.w * 0.35;
      tvpSprite.height = token.w * 0.35;
      tvpSprite.x = token.w * 0.8;
      tvpSprite.y = token.h * 0.2;
      tvpSprite.alpha = 1.0; // Volle Leuchtkraft
      token.addChild(tvpSprite);
    }

    // Farbsteuerung für das Auge:
    if (isZustandB_Hidden) {
      // Verbesserung 1: Global Unsichtbar + Ausnahmen -> Leuchtend Orange
      tvpSprite.tint = 0xFF9800; 
    } else if (isZustandB_Visible) {
      // Verbesserung 2: Global Sichtbar + Ausnahmen -> Leuchtend Orange
      tvpSprite.tint = 0xFF9800;
    } else {
      // Fallback (z.B. falls sich logisch was verschiebt) -> Signalrot
      tvpSprite.tint = 0xFF3333;
    }

  } else {
    // Wenn Zustand A (Keine Ausnahmen) oder Normalzustand -> Icon weg
    if (tvpSprite) {
      token.removeChild(tvpSprite);
      tvpSprite.destroy();
    }
  }
}

Hooks.once("init", () => {
  console.log("TokenVisibility+ | Initialisiere Modul...");

  // 1. REINER VISIBILITY-FILTER
  Object.defineProperty(Token.prototype, "isVisible", {
    get: function() {
      if (game.user.isGM) {
        if (this.mesh) this.mesh.alpha = getGmAlpha(this.document);
        return !this.document.hidden;
      }
      
      const visibleByMod = checkTvpVisibility(this.document, game.user.id);
      if (!visibleByMod) return false;

      if (this.mesh) this.mesh.alpha = 1.0;
      return !this.document.hidden && (this.layer.active || this.mesh.visible);
    },
    configurable: true
  });

  // 2. HARD-FILTER FÜR DETEKTION
  const originalTestCondition = DetectionMode.prototype._testCondition;
  DetectionMode.prototype._testCondition = function(visionSource, mode, target, match) {
    if (game.user.isGM) return originalTestCondition.call(this, visionSource, mode, target, match);
    
    if (target instanceof Token) {
      if (!checkTvpVisibility(target.document, game.user.id)) return false;
    }
    return originalTestCondition.call(this, visionSource, mode, target, match);
  };

  // 3. LICHTQUELLEN-VERNICHTER AN DER WURZEL
  const originalInitializeLightSource = Token.prototype.initializeLightSource;
  Token.prototype.initializeLightSource = function(...args) {
    if (game.user.isGM) return originalInitializeLightSource.apply(this, args);

    const visibleByMod = checkTvpVisibility(this.document, game.user.id);

    if (!visibleByMod) {
      if (this.light) {
        this.light.destroy();
        canvas.effects.lightSources.delete(this.light.sourceId);
        this.light = null;
      }
      return null;
    }

    return originalInitializeLightSource.apply(this, args);
  };
});

// 4. DESIGN-WECHSEL HOOK
Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
  const hasModChanges = changes.flags?.["token-visibility-plus"] !== undefined;
  const hasHiddenChanges = changes.hidden !== undefined;
  
  if (!hasModChanges && !hasHiddenChanges) return;

  const token = tokenDoc.object;
  if (!token) return;

  token.initializeLightSource();
  
  if (game.user.isGM) {
    if (token.mesh) token.mesh.alpha = getGmAlpha(tokenDoc);
    updateGmIcon(token);
  }

  canvas.perception.initialize({ lighting: true, sight: true });
});

// 5. INITIALES SCANNING BEIM LADEN DER SCENE & REFRESH
Hooks.on("canvasReady", () => {
  if (!game.user.isGM) return;
  for (let token of canvas.tokens.placeables) {
    updateGmIcon(token);
  }
});

Hooks.on("refreshToken", (token, flags) => {
  if (game.user.isGM && flags.refreshMesh) {
    updateGmIcon(token);
  }
});

let tvpMenuIsOpen = false;

Hooks.on("renderTokenHUD", (app, html, data) => {
  if (!game.user.isGM) return;

  const htmlElement = html.element instanceof HTMLElement ? html.element : (html instanceof HTMLElement ? html : html[0]);
  if (!htmlElement) return;

  const coreVisibilityButton = htmlElement.querySelector('.control-icon[data-action="visibility"]');
  if (!coreVisibilityButton) return;

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

  const isGlobalHidden = app.object.document.getFlag("token-visibility-plus", "globalHidden") || false;
  const eyeIconClass = isGlobalHidden ? "fa-eye-slash" : "fa-eye";
  const eyeText = isGlobalHidden ? "Alle: UNSICHTBAR" : "Alle: SICHTBAR";
  
  const icon = coreVisibilityButton.querySelector("i");
  if (icon) {
    icon.className = `fas ${eyeIconClass}`;
  }
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

  const toggleHeader = menuContainer.querySelector(".tvp-header-toggle");
  toggleHeader.addEventListener("click", async (event) => {
    event.stopPropagation();
    event.preventDefault();
    
    const tokenDocument = app.object.document;
    const newHiddenState = !isGlobalHidden;
    
    await tokenDocument.update({ hidden: false });
    await tokenDocument.setFlag("token-visibility-plus", "globalHidden", newHiddenState);
    
    app.render(true);
  });

  menuContainer.querySelectorAll(".tvp-user-row").forEach(row => {
    row.addEventListener("click", (event) => {
      event.stopPropagation();
    });
  });

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
    });
  });
});

Hooks.on("closeTokenHUD", () => {
  tvpMenuIsOpen = false;
});