const welcome = document.querySelector("#welcome");
const chat = document.querySelector("#chat");
const joinForm = document.querySelector("#join-form");
const messageForm = document.querySelector("#message-form");
const roomInput = document.querySelector("#room-input");
const messageInput = document.querySelector("#message-input");
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
let state = { name: guestName, room: "", lastId: 0, polling: false, timer: null };

const params = new URLSearchParams(location.search);
roomInput.value = params.get("room") || localStorage.lastRoom || "";

document.querySelector("#leave-room").addEventListener("click", leaveRoom);
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
  const room = roomInput.value.trim();
  if (!room) return;
  state = { name: guestName, room, lastId: 0, polling: false, timer: null };
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
  if (!text || !state.room) return;
  messageInput.value = "";
  resizeComposer();
  try {
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: state.room, name: state.name, text, clientId })
    });
    if (!response.ok) throw new Error("发送失败");
    await poll();
  } catch {
    messageInput.value = text;
    showToast("消息发送失败，请检查连接");
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
  bubble.textContent = message.text;
  item.append(meta, bubble);
  messagesEl.append(item);
  if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
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

function showToast(text) {
  toast.textContent = text;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}
