export function createAiView(deps) {
  const {
    DEFAULT_AI_PROMPT,
    GEMINI_ENDPOINT_DEFAULT,
    els,
    state,
    setStatus
  } = deps;

  function ensureDefaultAiPrompt() {
    if (!els.aiPrompt) return;
    if (!String(els.aiPrompt.value || "").trim()) {
      els.aiPrompt.value = DEFAULT_AI_PROMPT;
    }
  }


  function getCurrentAiModel() {
    if (!els.aiModelSelect) return "";
    if (els.aiModelSelect.value === "custom") {
      return String(els.aiModelCustom?.value || "").trim();
    }
    return String(els.aiModelSelect.value || "").trim();
  }

  function setModelCustomInputState() {
    if (!els.aiModelCustom || !els.aiModelSelect) return;
    const isCustom = els.aiModelSelect.value === "custom";
    els.aiModelCustom.disabled = !isCustom;
  }

  function ensureModelSelectPlaceholder() {
    if (!els.aiModelSelect) return;
    if (els.aiModelSelect.options.length === 0) {
      els.aiModelSelect.innerHTML = "";
    }

    const firstValue = String(els.aiModelSelect.options[0]?.value || "");
    if (els.aiModelSelect.options.length <= 2 && (firstValue === "" || firstValue === "custom")) {
      els.aiModelSelect.innerHTML = "";
      const tip = document.createElement("option");
      tip.value = "";
      tip.textContent = "Please input API key to load models";
      tip.disabled = true;
      tip.selected = true;
      els.aiModelSelect.appendChild(tip);

      const custom = document.createElement("option");
      custom.value = "custom";
      custom.textContent = "custom";
      els.aiModelSelect.appendChild(custom);
    }
  }

  function normalizeModelName(modelName) {
    const raw = String(modelName || "").trim();
    return raw.startsWith("models/") ? raw.slice(7) : raw;
  }

  function buildGeminiEndpoint(endpointTemplate, model, apiKey) {
    let endpoint = String(endpointTemplate || GEMINI_ENDPOINT_DEFAULT).trim();
    if (!endpoint) endpoint = GEMINI_ENDPOINT_DEFAULT;

    if (endpoint.includes("{model}")) {
      endpoint = endpoint.replace(/\{model\}/g, model);
    } else if (/\/v1beta\/?$/.test(endpoint) || /\/v1\/?$/.test(endpoint)) {
      endpoint = `${endpoint.replace(/\/$/, "")}/models/${model}:generateContent`;
    }

    const url = new URL(endpoint);
    url.searchParams.delete("key");
    if (apiKey) {
      url.searchParams.append("key", apiKey);
    }
    return url.toString();
  }

  function safeEndpointDisplay(endpointWithKey) {
    try {
      const url = new URL(endpointWithKey);
      if (url.searchParams.has("key")) {
        url.searchParams.set("key", "***");
      }
      return url.toString();
    } catch (error) {
      return endpointWithKey;
    }
  }

  function buildGeminiModelsEndpoint(endpointTemplate, apiKey, pageToken = "") {
    const endpointRaw = String(endpointTemplate || GEMINI_ENDPOINT_DEFAULT).trim() || GEMINI_ENDPOINT_DEFAULT;
    const seed = endpointRaw.includes("{model}") ? endpointRaw.replace(/\{model\}/g, "gemini-2.5-flash") : endpointRaw;
    const url = new URL(seed);

    let path = url.pathname;
    if (path.includes("/models/")) {
      path = `${path.split("/models/")[0]}/models`;
    } else if (/\/v1beta\/?$/.test(path) || /\/v1\/?$/.test(path)) {
      path = `${path.replace(/\/$/, "")}/models`;
    } else if (!/\/models\/?$/.test(path)) {
      path = `${path.replace(/\/$/, "")}/models`;
    }
    url.pathname = path;

    url.search = "";
    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }
    url.searchParams.set("pageSize", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }
    return url.toString();
  }

  async function fetchGeminiModelsFromApi(apiKey) {
    const found = [];
    let pageToken = "";

    for (let i = 0; i < 5; i += 1) {
      const endpoint = buildGeminiModelsEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, apiKey, pageToken);
      const response = await fetch(endpoint, { method: "GET" });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const models = Array.isArray(payload?.models) ? payload.models : [];
      for (const model of models) {
        const name = normalizeModelName(model?.name);
        if (!name) continue;
        if (!/^gemini/i.test(name)) continue;

        const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
        if (methods.length > 0 && !methods.includes("generateContent")) continue;

        found.push(name);
      }

      pageToken = String(payload?.nextPageToken || "");
      if (!pageToken) break;
    }

    const deduped = Array.from(new Set(found));
    deduped.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    return deduped;
  }

  function applyModelOptions(modelNames) {
    if (!els.aiModelSelect) return;
    const previous = getCurrentAiModel();
    const wasCustom = els.aiModelSelect.value === "custom";

    els.aiModelSelect.innerHTML = "";

    if (!modelNames.length) {
      const tip = document.createElement("option");
      tip.value = "";
      tip.textContent = "No models loaded";
      tip.disabled = true;
      tip.selected = true;
      els.aiModelSelect.appendChild(tip);
    } else {
      for (const modelName of modelNames) {
        const option = document.createElement("option");
        option.value = modelName;
        option.textContent = modelName;
        els.aiModelSelect.appendChild(option);
      }
    }

    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "custom";
    els.aiModelSelect.appendChild(customOption);

    if (previous && modelNames.includes(previous)) {
      els.aiModelSelect.value = previous;
    } else if (wasCustom || (previous && !modelNames.includes(previous))) {
      els.aiModelSelect.value = "custom";
      if (els.aiModelCustom && previous && !els.aiModelCustom.value) {
        els.aiModelCustom.value = previous;
      }
    } else if (modelNames.length) {
      els.aiModelSelect.value = modelNames[0];
    } else {
      els.aiModelSelect.value = "custom";
    }

    setModelCustomInputState();
  }

  async function refreshGeminiModels(options = {}) {
    const silent = Boolean(options.silent);
    const apiKey = String(els.aiApiKey?.value || "").trim();
    ensureModelSelectPlaceholder();

    if (!apiKey) {
      if (!silent) {
        setStatus("Please enter Gemini API key first.", "error");
      }
      applyModelOptions([]);
      updateAiEndpointPreview();
      return;
    }

    state.modelRefreshToken += 1;
    const token = state.modelRefreshToken;
    state.modelsLoading = true;

    const previousButtonText = els.refreshModels?.textContent || "";
    if (els.refreshModels) {
      els.refreshModels.disabled = true;
      els.refreshModels.textContent = "更新中...";
    }

    if (!silent) {
      setStatus("Loading Gemini models...", "");
    }

    try {
      const models = await fetchGeminiModelsFromApi(apiKey);
      if (token !== state.modelRefreshToken) return;
      applyModelOptions(models);
      if (!silent) {
        setStatus(`Gemini models loaded: ${models.length}`, "success");
      }
    } catch (error) {
      if (token !== state.modelRefreshToken) return;
      if (!silent) {
        setStatus(`Load model list failed: ${error.message}`, "error");
      }
    } finally {
      if (token === state.modelRefreshToken) {
        state.modelsLoading = false;
        if (els.refreshModels) {
          els.refreshModels.disabled = false;
          els.refreshModels.textContent = previousButtonText || "更新模型";
        }
        updateAiEndpointPreview();
      }
    }
  }

  function updateAiEndpointPreview() {
    if (!els.aiEndpointPreview) return;
    const model = getCurrentAiModel() || "gemini-2.5-flash";
    try {
      const endpoint = buildGeminiEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, model, "YOUR_KEY");
      const modelsEndpoint = buildGeminiModelsEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, "YOUR_KEY");
      els.aiEndpointPreview.textContent = `generateContent: ${safeEndpointDisplay(endpoint)} | listModels: ${safeEndpointDisplay(modelsEndpoint)}`;
    } catch (error) {
      els.aiEndpointPreview.textContent = `URL error: ${error.message}`;
    }
  }
function extractGeminiText(payload) {
    const chunks = [];
    const candidates = payload?.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts || [];
      for (const part of parts) {
        if (part?.text) {
          chunks.push(part.text);
        }
      }
    }
    return chunks.join("\n\n").trim();
  }

  function buildAiContext() {
    if (!state.analysis) return {};
    return {
      summary: state.analysis.summary,
      stays: state.analysis.stays.slice(0, 300),
      parking_60: state.analysis.parking_60.slice(0, 200),
      overnight: state.analysis.overnight.slice(0, 200),
      hotspots: state.analysis.hotspots.slice(0, 50),
      teleportations: state.analysis.anomalies.teleportations.slice(0, 200),
      hourly_distribution: state.analysis.hourly_distribution
    };
  }

  async function runGeminiAnalysis() {
    if (!state.analysis) {
      setStatus("Please run data analysis before AI analysis.", "error");
      return;
    }

    const apiKey = String(els.aiApiKey?.value || "").trim();
    const prompt = String(els.aiPrompt?.value || "").trim();
    const model = getCurrentAiModel();

    if (!apiKey) {
      setStatus("Please enter Gemini API key.", "error");
      return;
    }
    if (!model) {
      setStatus("Please choose a Gemini model.", "error");
      return;
    }
    if (!prompt) {
      setStatus("Please enter a prompt.", "error");
      return;
    }

    const context = buildAiContext();
    const composedPrompt = `${prompt}\n\n以下為系統分析資料(JSON)，請基於此資料回答，避免憑空推測：\n${JSON.stringify(context, null, 2)}`;

    let endpoint = "";
    try {
      endpoint = buildGeminiEndpoint(els.aiEndpointUrl?.value || GEMINI_ENDPOINT_DEFAULT, model, apiKey);
    } catch (error) {
      setStatus(`API URL error: ${error.message}`, "error");
      return;
    }

    if (els.aiOutput) {
      els.aiOutput.textContent = "Gemini analyzing...";
    }
    setStatus("Calling Gemini API...", "");

    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: composedPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(message);
      }

      const text = extractGeminiText(payload);
      if (!text) {
        throw new Error("Gemini returned empty text.");
      }
      if (els.aiOutput) {
        els.aiOutput.textContent = `[model] ${model}\n[API] ${safeEndpointDisplay(endpoint)}\n\n${text}`;
      }
      setStatus("Gemini analysis completed.", "success");
    } catch (error) {
      if (els.aiOutput) {
        els.aiOutput.textContent = `Gemini failed: ${error.message}`;
      }
      setStatus(`Gemini failed: ${error.message}`, "error");
    }
  }



  return {
    ensureDefaultAiPrompt,
    ensureModelSelectPlaceholder,
    refreshGeminiModels,
    runGeminiAnalysis,
    setModelCustomInputState,
    updateAiEndpointPreview
  };
}
