(function () {
  "use strict";

  const FSG = window.FSG;
  const ui = FSG.ui;
  const clamp = FSG.utils.clamp;

  function createApp() {
    const logger = new FSG.utils.DebugLog(ui.debugLog);
    const staticStore = new FSG.StaticPointsStore(logger);
    const liveStore = new FSG.LiveTimingStore(logger);
    const engine = new FSG.ScoreEngine(liveStore, staticStore);
    const renderer = new FSG.Renderer(liveStore, staticStore, engine);

    liveStore.onUpdate = () => renderer.render();

    function bindStaticInputEditing() {
      document.body.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (!target.classList.contains("static-input")) return;

        const cup = target.dataset.cup;
        const carId = target.dataset.carid;
        const field = target.dataset.field;
        const min = Number(target.min || 0);
        const max = Number(target.max || 0);
        const value = clamp(Number(target.value || 0), min, max);
        target.value = String(value);

        staticStore.set(cup, carId, field, value);
        logger.write("INFO", "Manual score edited", { cup, carId, field, value });
        renderer.render();
      });
    }

    async function loadBaseData() {
      await staticStore.loadBaseData(FSG.pageCup);
    }

    function bindFileInputs() {
      function readAndImport(file, cup, kind) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          const count = staticStore.importText(cup, text, kind, true);
          alert("Imported " + count + " entries for " + cup + " " + kind + ".");
          renderer.render();
        };
        reader.onerror = () => {
          logger.write("ERROR", "Failed to read CSV file", { cup, kind, file: file.name });
          alert("Could not read file " + file.name + ".");
        };
        reader.readAsText(file);
      }

      if (ui.staticFile) {
        ui.staticFile.addEventListener("change", () => {
          readAndImport(ui.staticFile.files[0], FSG.pageCup, "static");
          ui.staticFile.value = "";
        });
      }

      if (ui.penaltiesFile) {
        ui.penaltiesFile.addEventListener("change", () => {
          readAndImport(ui.penaltiesFile.files[0], FSG.pageCup, "penalties");
          ui.penaltiesFile.value = "";
        });
      }
    }

    function bindButtons() {
      ui.reconnectBtn.addEventListener("click", () => {
        logger.write("INFO", "Manual reconnect requested");
        liveStore.connect();
      });

      ui.clearDebugBtn.addEventListener("click", () => {
        logger.clear();
        logger.write("INFO", "Debug log cleared");
      });
    }

    return {
      async start() {
        await loadBaseData();
        bindStaticInputEditing();
        bindFileInputs();
        bindButtons();
        renderer.render();
        liveStore.connect();
      }
    };
  }

  window.FSG = window.FSG || {};
  window.FSG.startApp = async function startApp() {
    const app = createApp();
    await app.start();
  };
})();
