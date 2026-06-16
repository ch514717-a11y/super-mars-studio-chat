const welcome = document.querySelector("#welcome");
const chat = document.querySelector("#chat");
const joinForm = document.querySelector("#join-form");
const messageForm = document.querySelector("#message-form");
const roomInput = document.querySelector("#room-input");
const messageInput = document.querySelector("#message-input");
const imageInput = document.querySelector("#image-input");
const imagePreview = document.querySelector("#image-preview");
const imagePreviewImg = document.querySelector("#image-preview-img");
const dropOverlay = document.querySelector("#drop-overlay");
const sendButton = messageForm.querySelector(".send-button");
const messagesEl = document.querySelector("#messages");
const emptyState = document.querySelector("#empty-state");
const roomTitle = document.querySelector("#room-title");
const onlineCount = document.querySelector("#online-count");
const statusEl = document.querySelector("#status");
const toast = document.querySelector("#toast");

const clientId = sessionStorage.clientId || crypto.randomUUID();
sessionStorage.clientId = clientId;
const guestName = sessionStorage.guestName || `顾客-${clientId.slice(0, 4).toUpperCase()}`;
sessionStorage.guestName = guestName;
let state = { name: guestName, room: "", lastId: 0, polling: false, timer: null, image: "", imageProcessing: false };
let dragDepth = 0;

const params = new URLSearchParams(location.search);
roomInput.value = normalizeRoom(params.get("room") || localStorage.lastRoom || "");

document.querySelector("#leave-room").addEventListener("click", leaveRoom);
document.querySelector("#choose-image").addEventListener("click", () => imageInput.click());
document.querySelector("#remove-image").addEventListener("click", clearImage);
imageInput.addEventListener("change", prepareImage);
chat.addEventListener("dragenter", handleDragEnter);
chat.addEventListener("dragover", handleDragOver);
chat.addEventListener("dragleave", handleDragLeave);
chat.addEventListener("drop", handleDrop);
messageInput.addEventListener("paste", handlePaste);
document.addEventListener("dragover", preventFileNavigation);
document.addEventListener("drop", preventFileNavigation);
document.querySelector("#copy-link").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", state.room);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast("邀请链接已复制");
  } catch {
    prompt("复制这个邀请链接：", url.toString());
  }
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const room = normalizeRoom(roomInput.value);
  if (!room) return;
  roomInput.value = room;
  state = { name: guestName, room, lastId: 0, polling: false, timer: null, image: "", imageProcessing: false };
  localStorage.lastRoom = room;
  roomTitle.textContent = room;
  welcome.classList.add("hidden");
  chat.classList.remove("hidden");
  messagesEl.querySelectorAll(".message").forEach((node) => node.remove());
  emptyState.classList.remove("hidden");
  history.replaceState({}, "", `?room=${encodeURIComponent(room)}`);
  messageInput.focus();
  poll();
});

if (params.has("room") && roomInput.value) {
  joinForm.requestSubmit();
}

messageForm.addEventListener("submit", sendMessage);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});
messageInput.addEventListener("input", resizeComposer);

async function sendMessage(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  const image = state.image;
  if (state.imageProcessing) return showToast("图片正在处理，请稍候");
  if ((!text && !image) || !state.room) return;
  sendButton.disabled = true;
  messageInput.value = "";
  clearImage();
  resizeComposer();
  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: state.room, name: state.name, text, image, clientId })
    });
    if (!response.ok) throw new Error("发送失败");
    await poll();
  } catch {
    messageInput.value = text;
    if (image) setImage(image);
    showToast("消息发送失败，请检查连接");
  } finally {
    sendButton.disabled = false;
  }
}

async function poll() {
  if (!state.room || state.polling) return;
  state.polling = true;
  clearTimeout(state.timer);
  try {
    const query = new URLSearchParams({ room: state.room, after: state.lastId, client: clientId });
    const response = await fetch(`/api/messages?${query}`);
    if (!response.ok) throw new Error("连接失败");
    const data = await response.json();
    data.messages.forEach(addMessage);
    restyleMessages();
    onlineCount.textContent = data.online;
    statusEl.textContent = "已连接";
  } catch {
    statusEl.textContent = "连接中断，正在重试…";
  } finally {
    state.polling = false;
    if (state.room) state.timer = setTimeout(poll, 900);
  }
}

function addMessage(message) {
  state.lastId = Math.max(state.lastId, Number(message.id));
  if (document.querySelector(`[data-message-id="${message.id}"]`)) return;
  emptyState.classList.add("hidden");
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
  const item = document.createElement("article");
  item.className = `message${message.clientId === clientId ? " mine" : ""}`;
  item.dataset.messageId = message.id;
  applyMessageItemStyle(item);

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const name = document.createElement("span");
  name.className = "message-name";
  name.textContent = message.clientId === clientId ? "我" : message.name;
  const time = document.createElement("time");
  time.textContent = new Date(message.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  meta.append(name, time);

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  applyMessageBubbleStyle(bubble);
  if (message.image) {
    const link = document.createElement("a");
    link.href = message.image;
    link.target = "_blank";
    link.rel = "noopener";
    const image = document.createElement("img");
    image.className = "message-image";
    image.src = message.image;
    image.alt = "聊天图片";
    link.append(image);
    bubble.append(link);
  }
  if (message.text) {
    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;
    bubble.append(text);
  }
  item.append(meta, bubble);
  messagesEl.append(item);
  if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function applyMessageItemStyle(item) {
  item.style.width = "fit-content";
  item.style.maxWidth = "72%";
  if (item.classList.contains("mine")) item.style.marginLeft = "auto";
}

function normalizeRoom(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 24);
}

function applyMessageBubbleStyle(bubble) {
  Object.assign(bubble.style, {
    display: "inline-block",
    maxWidth: "100%",
    color: "var(--ink)",
    background: "rgba(255, 255, 255, 0.46)",
    border: "1px solid rgba(255, 255, 255, 0.48)",
    boxShadow: "0 5px 18px rgba(38, 57, 45, 0.045)",
    backdropFilter: "blur(10px)",
    fontSize: "10px",
    lineHeight: "1.38"
  });
}

function restyleMessages() {
  document.querySelectorAll(".message").forEach(applyMessageItemStyle);
  document.querySelectorAll(".message-bubble").forEach(applyMessageBubbleStyle);
}

function leaveRoom() {
  clearTimeout(state.timer);
  state.room = "";
  chat.classList.add("hidden");
  welcome.classList.remove("hidden");
  history.replaceState({}, "", location.pathname);
}

function resizeComposer() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
}

async function prepareImage() {
  const file = imageInput.files[0];
  if (file) await processImageFile(file);
}

async function processImageFile(file) {
  if (!isImageFile(file)) return showToast("请拖入 JPG、PNG、WebP 或 GIF 图片");
  state.imageProcessing = true;
  sendButton.disabled = true;
  showToast("正在处理图片…");
  try {
    const image = file.type === "image/gif" && file.size <= 450000
      ? await readFile(file)
      : await compressImage(file);
    if (image.length > 620000) throw new Error("图片太大");
    setImage(image);
    messageInput.focus();
    showToast("图片已进入输入框，点击发送");
  } catch {
    clearImage();
    showToast("图片太大或无法读取");
  } finally {
    state.imageProcessing = false;
    sendButton.disabled = false;
  }
}

function isImageFile(file) {
  return file && (
    ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) ||
    /\.(jpe?g|png|webp|gif)$/i.test(file.name || "")
  );
}

function preventFileNavigation(event) {
  if (hasFiles(event.dataTransfer)) event.preventDefault();
}

function handleDragEnter(event) {
  if (!hasFiles(event.dataTransfer)) return;
  event.preventDefault();
  dragDepth++;
  chat.classList.add("is-dragging");
}

function handleDragOver(event) {
  if (!hasFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function handleDragLeave(event) {
  if (!dragDepth) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) chat.classList.remove("is-dragging");
}

async function handleDrop(event) {
  if (!hasFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.stopPropagation();
  dragDepth = 0;
  chat.classList.remove("is-dragging");
  const file = [...event.dataTransfer.files].find(isImageFile);
  if (file) await processImageFile(file);
  else showToast("没有找到可用图片，请从文件夹拖入图片文件");
}

async function handlePaste(event) {
  const file = [...event.clipboardData.items]
    .find(item => item.kind === "file" && item.type.startsWith("image/"))
    ?.getAsFile();
  if (!file) return;
  event.preventDefault();
  await processImageFile(file);
}

function hasFiles(dataTransfer) {
  return dataTransfer && [...dataTransfer.types].includes("Files");
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const source = "createImageBitmap" in window
    ? await createImageBitmap(file)
    : await loadImage(await readFile(file));
  const scale = Math.min(1, 1280 / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvas.toDataURL("image/jpeg", 0.72);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function setImage(image) {
  state.image = image;
  imagePreviewImg.src = image;
  imagePreview.classList.remove("hidden");
}

function clearImage() {
  state.image = "";
  imageInput.value = "";
  imagePreviewImg.removeAttribute("src");
  imagePreview.classList.add("hidden");
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}
