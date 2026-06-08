const API_BASE =
  window.CLIPBOARD_API_BASE ||
  (location.hostname.endsWith("github.io") ? "https://firstweb-api.onrender.com" : "");

const putForm = document.querySelector("#put");
const findForm = document.querySelector("#findForm");
const textInput = document.querySelector("#textInput");
const fileInput = document.querySelector("#fileInput");
const fileName = document.querySelector("#fileName");
const ttlInput = document.querySelector("#ttlInput");
const createdResult = document.querySelector("#createdResult");
const createdCode = document.querySelector("#createdCode");
const createdMeta = document.querySelector("#createdMeta");
const copyCode = document.querySelector("#copyCode");
const codeInput = document.querySelector("#codeInput");
const foundResult = document.querySelector("#foundResult");
const foundCode = document.querySelector("#foundCode");
const foundExpire = document.querySelector("#foundExpire");
const foundText = document.querySelector("#foundText");
const downloadLink = document.querySelector("#downloadLink");
const copyText = document.querySelector("#copyText");
const toast = document.querySelector("#toast");

let latestCode = "";
let latestText = "";

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileName.textContent = file ? `${file.name} · ${formatSize(file.size)}` : "未选择文件，最大 5MB";
});

putForm.addEventListener("submit", async event => {
  event.preventDefault();

  try {
    ensureApiReady();
    const file = fileInput.files[0] || null;
    const payload = {
      text: textInput.value,
      ttlHours: Number(ttlInput.value),
      file: file ? await readFileAsPayload(file) : null
    };

    if (!payload.text.trim() && !payload.file) {
      return showToast("请先输入文本或选择文件");
    }

    const response = await fetch(apiUrl("/api/blocks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(errorText(result.error));
    }

    latestCode = result.code;
    createdCode.textContent = result.code;
    createdMeta.textContent = `有效期至 ${formatTime(result.expiresAt)}`;
    createdResult.classList.remove("hidden");
    showToast("识别码已生成");
  } catch (error) {
    showToast(error.message || "生成失败");
  }
});

findForm.addEventListener("submit", async event => {
  event.preventDefault();
  const code = codeInput.value.trim().toUpperCase();

  if (!/^[A-Z0-9]{4}$/.test(code)) {
    return showToast("请输入 4 位识别码");
  }

  try {
    ensureApiReady();
    const response = await fetch(apiUrl(`/api/blocks/${code}`));
    const result = await response.json();
    if (!response.ok) {
      throw new Error(errorText(result.error));
    }

    latestText = result.text || "";
    foundCode.textContent = result.code;
    foundExpire.textContent = `有效期至 ${formatTime(result.expiresAt)}`;
    foundText.textContent = latestText || "这块内容没有文本。";

    if (result.file) {
      downloadLink.textContent = `下载 ${result.file.name} · ${formatSize(result.file.size)}`;
      downloadLink.href = apiUrl(result.file.url);
      downloadLink.classList.remove("hidden");
    } else {
      downloadLink.classList.add("hidden");
    }

    copyText.classList.toggle("hidden", !latestText);
    foundResult.classList.remove("hidden");
    showToast("已找到内容");
  } catch (error) {
    foundResult.classList.add("hidden");
    showToast(error.message || "查找失败");
  }
});

copyCode.addEventListener("click", () => {
  copyToClipboard(latestCode);
});

copyText.addEventListener("click", () => {
  copyToClipboard(latestText);
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
});

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function ensureApiReady() {
  if (location.hostname.endsWith("github.io") && !API_BASE) {
    throw new Error("请先配置后端 API 地址");
  }
}

function readFileAsPayload(file) {
  if (file.size > 5 * 1024 * 1024) {
    return Promise.reject(new Error("文件不能超过 5MB"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        dataUrl: reader.result
      });
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function copyToClipboard(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast("已复制");
  } catch {
    showToast("复制失败，请手动复制");
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function errorText(code) {
  const map = {
    empty_content: "内容不能为空",
    text_too_large: "文本不能超过 512KB",
    file_too_large: "文件不能超过 5MB",
    not_found: "没有找到这块内容，可能已过期",
    body_too_large: "上传内容过大"
  };
  return map[code] || "操作失败";
}
