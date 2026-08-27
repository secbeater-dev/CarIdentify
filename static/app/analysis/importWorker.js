/* Classic worker: load SheetJS / fflate globals, then import the ES module pipeline. */
importScripts(
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "../../vendor/fflate-0.8.2.min.js"
);

const PIPELINE_URL = new URL("./importPipeline.js?v=20260827a", self.location.href).href;

self.onmessage = async (event) => {
  const payload = event.data || {};
  if (payload.type !== "import") return;

  try {
    const pipeline = await import(PIPELINE_URL);
    const result = await pipeline.importWorkbooks(payload.files || [], payload.options || {}, (progress) => {
      self.postMessage({ type: "progress", ...progress });
    });
    const plateImageJobs = result.plateImageJobs || [];
    const transfer = [];
    for (const job of plateImageJobs) {
      if (job.buffer instanceof ArrayBuffer) {
        transfer.push(job.buffer);
      }
    }
    self.postMessage({
      type: "done",
      analysis: result.analysis,
      plateImageJobs
    }, transfer);
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error?.message || String(error)
    });
  }
};
