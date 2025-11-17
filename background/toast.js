function createArcToast(url) {
  if (document.getElementById("arc-repin-inline-toast")) return;

  const container = document.createElement("div");
  container.id = "arc-repin-inline-toast";
  container.style.position = "fixed";
  container.style.right = "16px";
  container.style.bottom = "16px";
  container.style.zIndex = "2147483647";
  container.style.background = "#111827";
  container.style.color = "#F9FAFB";
  container.style.padding = "14px 16px";
  container.style.borderRadius = "8px";
  container.style.boxShadow = "0 10px 30px rgba(0,0,0,0.4)";
  container.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI'";
  container.style.fontSize = "13px";
  container.style.maxWidth = "320px";

  // Close button (X)
  const closeBtn = document.createElement("div");
  closeBtn.textContent = "×";
  closeBtn.style.position = "absolute";
  closeBtn.style.top = "4px";
  closeBtn.style.right = "8px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "16px";
  closeBtn.style.opacity = "0.7";
  closeBtn.addEventListener("mouseover", () => closeBtn.style.opacity = "1");
  closeBtn.addEventListener("mouseout", () => closeBtn.style.opacity = "0.7");
  closeBtn.addEventListener("click", () => container.remove());

  const text = document.createElement("div");
  text.textContent = "ARC RePin automatically restored this managed pinned tab.";
  text.style.marginBottom = "6px";

  const urlLine = document.createElement("div");
  urlLine.textContent = url;
  urlLine.style.fontSize = "11px";
  urlLine.style.opacity = "0.7";
  urlLine.style.whiteSpace = "nowrap";
  urlLine.style.overflow = "hidden";
  urlLine.style.textOverflow = "ellipsis";
  urlLine.style.marginBottom = "10px";

  const buttons = document.createElement("div");
  buttons.style.display = "flex";
  buttons.style.gap = "6px";
  buttons.style.justifyContent = "flex-end";

  const makeBtn = (label, bg) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.border = "none";
    b.style.padding = "4px 8px";
    b.style.borderRadius = "6px";
    b.style.fontSize = "11px";
    b.style.cursor = "pointer";
    b.style.background = bg;
    b.style.color = "#F9FAFB";
    return b;
  };

  const closeOnceBtn = makeBtn("Close only this time", "#4B5563");
  const removeBtn = makeBtn("Close & remove", "#EF4444");

  closeOnceBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "arc-repin-close-once" });
    container.remove();
  });

  removeBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "arc-repin-close-and-remove" });
    container.remove();
  });

  buttons.appendChild(closeOnceBtn);
  buttons.appendChild(removeBtn);

  container.appendChild(closeBtn);
  container.appendChild(text);
  container.appendChild(urlLine);
  container.appendChild(buttons);

  document.body.appendChild(container);

  // Auto-dismiss after 8s if user doesn’t touch it
  let dismissTimer = setTimeout(() => {
    container.remove();
  }, 8000);

  // If user hovers, pause timer
  container.addEventListener("mouseenter", () => {
    clearTimeout(dismissTimer);
  });

  // If user leaves, restart timer
  container.addEventListener("mouseleave", () => {
    dismissTimer = setTimeout(() => container.remove(), 6000);
  });
}

// listen for background telling us to show the toast
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "arc-repin-managed-tab-reopened") {
    createArcToast(msg.originUrl);
  }
});

