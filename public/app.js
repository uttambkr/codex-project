const usernameInput = document.getElementById("username");
const joinBtn = document.getElementById("joinBtn");
const onlineList = document.getElementById("onlineList");
const typingIndicator = document.getElementById("typingIndicator");
const messagesEl = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const sessionId = crypto.randomUUID();
let username = "";
let typingTimeout;

const eventSource = new EventSource("/events");

const post = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
};

const addMessage = ({ sender, text, time, mine = false, system = false }) => {
  const bubble = document.createElement("article");
  bubble.className = `bubble ${system ? "system" : mine ? "mine" : "theirs"}`;

  const body = document.createElement("div");
  body.textContent = text;
  bubble.appendChild(body);

  if (!system) {
    const meta = document.createElement("small");
    meta.className = "meta";
    meta.textContent = `${sender} • ${time}`;
    bubble.appendChild(meta);
  }

  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
};

const refreshState = async () => {
  const state = await fetch("/state").then((r) => r.json());
  state.messages.forEach((payload) => {
    addMessage({ ...payload, mine: payload.sender === username });
  });
  onlineList.innerHTML = "";
  state.online.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    onlineList.appendChild(li);
  });
};

joinBtn.addEventListener("click", async () => {
  const value = usernameInput.value.trim();
  if (!value) return;

  const result = await post("/join", { username: value, sessionId });
  username = result.username;

  usernameInput.disabled = true;
  joinBtn.disabled = true;
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
});

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !username) return;

  await post("/message", { sender: username, text });
  await post("/typing", { username, isTyping: false });
  messageInput.value = "";
});

messageInput.addEventListener("input", async () => {
  if (!username) return;
  await post("/typing", { username, isTyping: true });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    post("/typing", { username, isTyping: false });
  }, 800);
});

eventSource.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);
  addMessage({ ...payload, mine: payload.sender === username });
});

eventSource.addEventListener("system", (event) => {
  const { text, time } = JSON.parse(event.data);
  addMessage({ text: `${text} (${time})`, system: true });
});

eventSource.addEventListener("presence", (event) => {
  const { online } = JSON.parse(event.data);
  onlineList.innerHTML = "";
  online.forEach((name) => {
    const li = document.createElement("li");
    li.textContent = name;
    onlineList.appendChild(li);
  });
});

eventSource.addEventListener("typing", (event) => {
  const { username: typingUser, isTyping } = JSON.parse(event.data);
  if (typingUser === username) return;
  typingIndicator.textContent = isTyping ? `${typingUser} is typing...` : "";
});

window.addEventListener("beforeunload", () => {
  if (username) {
    navigator.sendBeacon(
      "/leave",
      new Blob([JSON.stringify({ sessionId })], { type: "application/json" })
    );
  }
});

refreshState();
