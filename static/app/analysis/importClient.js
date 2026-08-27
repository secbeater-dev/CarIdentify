import { importWorkbooks } from "./importPipeline.js?v=20260827a";

const WORKER_URL = new URL("./importWorker.js?v=20260827a", import.meta.url);

function buffersWereTransferred(files) {
  return (Array.isArray(files) ? files : []).some(
    (file) => file?.buffer instanceof ArrayBuffer && file.buffer.byteLength === 0
  );
}

function runInWorker(files, options, onProgress) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(WORKER_URL);
    } catch (error) {
      reject(error);
      return;
    }

    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
    };

    const onMessage = (event) => {
      const data = event.data || {};
      if (data.type === "progress") {
        onProgress?.(data);
        return;
      }
      if (data.type === "done") {
        cleanup();
        resolve({
          analysis: data.analysis,
          plateImageJobs: data.plateImageJobs || []
        });
        return;
      }
      if (data.type === "error") {
        cleanup();
        reject(new Error(data.message || "匯入失敗"));
      }
    };

    const onError = (event) => {
      cleanup();
      reject(event?.error || new Error(event?.message || "匯入背景工作失敗"));
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);

    const transfer = [];
    for (const file of files) {
      if (file.buffer instanceof ArrayBuffer) {
        transfer.push(file.buffer);
      }
    }
    worker.postMessage({ type: "import", files, options }, transfer);
  });
}

export async function runWorkbookImport(files, options, onProgress) {
  if (typeof Worker !== "function") {
    return importWorkbooks(files, options, onProgress);
  }

  try {
    return await runInWorker(files, options, onProgress);
  } catch (error) {
    if (!buffersWereTransferred(files)) {
      return importWorkbooks(files, options, onProgress);
    }
    error.needsReread = true;
    throw error;
  }
}

export { importWorkbooks };
