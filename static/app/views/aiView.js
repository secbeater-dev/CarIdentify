export function createAiView(deps) {
  const { DEFAULT_AI_PROMPT, els, setStatus } = deps;

  function ensureDefaultAiPrompt() {
    if (!els.aiPrompt) return;
    if (!String(els.aiPrompt.value || "").trim()) {
      els.aiPrompt.value = DEFAULT_AI_PROMPT;
    }
  }

  async function copyAiPrompt() {
    const text = String(els.aiPrompt?.value || "");
    if (!text.trim()) {
      setStatus("提示詞是空的。", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已複製提示詞。請自行貼到你慣用的 AI，並注意資料安全。", "success");
    } catch (error) {
      setStatus("複製失敗，請手動選取提示詞複製。", "error");
    }
  }

  return {
    ensureDefaultAiPrompt,
    copyAiPrompt
  };
}
