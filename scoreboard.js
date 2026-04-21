(function () {
  "use strict";

  if (!window.FSG || typeof window.FSG.startApp !== "function") {
    console.error("FSG app modules are missing. Ensure split scripts are loaded before scoreboard.js.");
    return;
  }

  window.FSG.startApp().catch((error) => {
    console.error("Failed to start FSG app", error);
  });
})();
