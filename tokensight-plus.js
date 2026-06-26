/**
 * TokenSight+ Modul für Foundry VTT v14
 * Variante B (Blacklist): Blockiert gezielt JEDEN Detection Mode (inkl. Spezialsinnen).
 * UI: Eigener Button in der rechten HUD-Spalte mit Mystery-Man-Icon.
 * GM-Feedback: Nativer, ungefärbter Mystery-Man als Token-Overlay.
 * Prep-Ready: Liest NUR fest zugewiesene Hauptfiguren aus (auch offline).
 */

const TVP_MASK_ICON = "icons/svg/mystery-man.svg";

// Prüft, ob die Sicht für einen SC BLOCKIERT ist (Blacklist)
function isPerceptionBlocked(tokenDoc, observerActorId) {
  if (!tokenDoc || !observerActorId) return false; 
  const blockedActors = tokenDoc.getFlag("tokensight-plus", "blockedActors") || [];
  return blockedActors.includes(observerActorId);
}

// Visuelles Feedback für den GM (Ungefärbter Mystery-Man als Token-Overlay)
function updateGmFeedback(token) {
  if (!token || !game.user.isGM) return;

  const blockedActors = token.document.getFlag("tokensight-plus", "blockedActors") || [];
  let tvpSprite = token.getChildByName("tvpMaskIcon");

  if (blockedActors.length > 0 && !token.document.hidden) {
    if (!tvpSprite) {
      tvpSprite = PIXI.Sprite.from(TVP_MASK_ICON);
      tvpSprite.name = "tvpMaskIcon";
      tvpSprite.anchor.set(0.5);
      tvpSprite.width = token.w * 0.35;
      tvpSprite.height = token.w * 0.35;
      tvpSprite.x = token.w * 0.8;
      tvpSprite.y = token.h * 0.2;
      tvpSprite.alpha = 1.0;
      token.addChild(tvpSprite);
    }
  } else {
    if (tvpSprite) {
      token.removeChild(tvpSprite);
      tvpSprite.destroy();
    }
  }
}

Hooks.once("init", () => {
  console.log("TokenVisibility+ | Initialisiere Sinnes-Blacklist (Hauptfiguren-Fokus)...");

  // 1. DER SINNES-FAKER
  const originalTestVisibility = DetectionMode.prototype.testVisibility;
  DetectionMode.prototype.testVisibility = function(visionSource, mode, config={}) {
    if (game.user.isGM) return originalTestVisibility.call(this, visionSource, mode, config);
    
    if (config.object instanceof Token) {
      const observerActor = visionSource.object?.actor;
      
      if (observerActor) {
        if (isPerceptionBlocked(config.object.document, observerActor.id)) {
          return false; 
        }
      }
    }
    
    return originalTestVisibility.call(this, visionSource, mode, config);
  };

  // 2. LICHTQUELLEN-BLOCKER 
  const originalInitializeLightSource = Token.prototype.initializeLightSource;
  Token.prototype.initializeLightSource = function(...args) {
    if (!game.user.isGM) {
      const myMainCharId = game.user.character?.id;
      if (isPerceptionBlocked(this.document, myMainCharId)) {
        if (this.light) {
          this.light.destroy();
          canvas.effects.lightSources.delete(this.light.sourceId);
          this.light = null;
        }
        return null;
      }
    }
    return originalInitializeLightSource.apply(this, args);
  };
});

Hooks.on("refreshToken", (token, flags) => {
  if (game.user.isGM) updateGmFeedback(token);
});

Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
  if (changes.flags?.["tokensight-plus"] === undefined && changes.hidden === undefined) return;
  
  const token = tokenDoc.object;
  if (!token) return;

  token.initializeLightSource();
  canvas.perception.initialize({ lighting: true, sight: true });
});

Hooks.on("canvasReady", () => {
  if (!game.user.isGM) return;
  for (let token of canvas.tokens.placeables) {
    updateGmFeedback(token);
  }
});

// --- TOKEN-HUD MENÜ ---
let tvpMenuIsOpen = false;

Hooks.on("renderTokenHUD", (app, html, data) => {
  if (!game.user.isGM) return;

  const htmlElement = html.element instanceof HTMLElement ? html.element : (html instanceof HTMLElement ? html : html[0]);
  if (!htmlElement) return;

  const rightCol = htmlElement.querySelector('.col.right');
  if (!rightCol) return;

  const customButton = document.createElement("div");
  customButton.className = "control-icon tvp-blacklist-toggle";
  customButton.title = "TokenSight+ (Blacklist)"; 

  const blockedActors = app.object.document.getFlag("tokensight-plus", "blockedActors") || [];
  const isActive = blockedActors.length > 0;
  
  // CSS-Filter, um das weiße SVG bei Aktivität rot zu färben
  const redFilter = "invert(35%) sepia(90%) saturate(3000%) hue-rotate(340deg) brightness(100%) contrast(100%)";
  customButton.innerHTML = `<img src="${TVP_MASK_ICON}" style="width: 24px; height: 24px; margin-top: 3px; ${isActive ? `filter: ${redFilter};` : ''}" />`;

  const hiddenClass = tvpMenuIsOpen ? "" : "hidden";
  const menuContainer = document.createElement("div");
  menuContainer.className = `tvp-menu-container ${hiddenClass}`;
  
  menuContainer.style.position = "absolute";
  menuContainer.style.right = "50px";
  menuContainer.style.top = "0";
  menuContainer.style.zIndex = "100";

  menuContainer.innerHTML = `
    <ul class="tvp-menu-list" style="padding: 5px; background: rgba(0,0,0,0.8); border: 1px solid #333; border-radius: 5px; min-width: 150px; text-align: left; list-style: none; margin: 0;">
      <li class="tvp-header" style="font-size:12px; font-weight:bold; color:#ff4444; border-bottom:1px solid #7a7975; padding-bottom:4px; margin-bottom: 6px; display: flex; align-items: center;">
        <img src="${TVP_MASK_ICON}" style="width: 14px; height: 14px; margin-right: 6px; filter: ${redFilter};" /> Sicht blockiert für:
      </li>
      <div class="tvp-menu-list-items"></div>
    </ul>
  `;

  // Filtert präzise nach den in Foundry fest zugewiesenen Hauptfiguren (unabhängig vom Online-Status)
  const activeMainCharacters = game.users
    .filter(u => !u.isGM && u.character)
    .map(u => u.character);
    
  const uniqueMainCharacters = [...new Map(activeMainCharacters.map(item => [item.id, item])).values()];
  const listItemsContainer = menuContainer.querySelector(".tvp-menu-list-items");

  if (uniqueMainCharacters.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.innerText = "Keine Hauptfiguren zugewiesen";
    emptyLi.style.fontSize = "11px";
    emptyLi.style.color = "#aaa";
    listItemsContainer.appendChild(emptyLi);
  } else {
    uniqueMainCharacters.forEach(actor => {
      const isChecked = blockedActors.includes(actor.id) ? "checked" : "";
      const item = document.createElement("li");
      item.className = "tvp-user-row";
      item.style.marginBottom = "4px";
      item.innerHTML = `
        <label style="width:100%; display:flex; align-items:center; cursor:pointer; font-size: 13px;">
          <input type="checkbox" class="tvp-user-checkbox" data-actor-id="${actor.id}" ${isChecked} style="margin-right: 8px;">
          <span class="tvp-username" style="color: white;">${actor.name}</span>
        </label>
      `;
      listItemsContainer.appendChild(item);
    });
  }

  customButton.appendChild(menuContainer);
  rightCol.appendChild(customButton);

  if (tvpMenuIsOpen) customButton.classList.add("active");

  customButton.addEventListener("click", (event) => {
    if (event.target.closest(".tvp-menu-container")) return;
    event.stopPropagation();
    event.preventDefault();

    tvpMenuIsOpen = !menuContainer.classList.toggle("hidden");
    customButton.classList.toggle("active", tvpMenuIsOpen);
  });

  menuContainer.querySelectorAll(".tvp-user-checkbox").forEach(checkbox => {
    checkbox.addEventListener("change", async (event) => {
      event.stopPropagation();
      const cb = event.currentTarget;
      const actorId = cb.dataset.actorId; 
      const tokenDocument = app.object.document;
      let currentBlocked = tokenDocument.getFlag("tokensight-plus", "blockedActors") || [];

      if (cb.checked) {
        if (!currentBlocked.includes(actorId)) currentBlocked.push(actorId);
      } else {
        currentBlocked = currentBlocked.filter(id => id !== actorId);
      }

      await tokenDocument.setFlag("tokensight-plus", "blockedActors", currentBlocked);
      app.render(true);
    });
  });
});

Hooks.on("closeTokenHUD", () => {
  tvpMenuIsOpen = false;
});