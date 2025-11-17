
function loadTabs() {
  const table = document.getElementById("pinnedList");
  table.innerHTML = "";

  chrome.storage.sync.get("storedTabs", (data) => {
    const storedTabs = data.storedTabs || {};
    const urls = Object.keys(storedTabs);

    if (urls.length === 0) {
      const row = table.insertRow();
      const cell = row.insertCell(0);
      cell.colSpan = 4;
      cell.className = "py-4 text-center text-gray-500";
      cell.textContent = "No pinned sites yet.";
      return;
    }

    const sortedUrls = urls.sort((a, b) => storedTabs[a] - storedTabs[b]);

    // header
    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr class="text-left text-gray-600 border-b">
        <th class="py-2 pr-4 w-10">#</th>
        <th class="py-2 pr-4 w-40">Site</th>
        <th class="py-2 pr-4">URL</th>
        <th class="py-2 text-right w-40">Actions</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    sortedUrls.forEach((url, idx) => {
      const row = document.createElement("tr");
      row.className = "border-b last:border-none";

      let hostname = url;
      try { hostname = new URL(url).hostname; } catch {}

      row.innerHTML = `
        <td class="py-2 pr-4 text-gray-700">${idx + 1}</td>

        <td class="py-2 pr-4 flex items-center gap-2">
          <img src="chrome://favicon/${url}" class="w-4 h-4">
          <span>${hostname}</span>
        </td>

        <td class="py-2 pr-4 text-gray-700 truncate-2" title="${url}">
          ${url}
        </td>

        <td class="py-2 text-right space-x-1">
          <button class="px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-xs" data-remove>Remove</button>
        </td>
      `;

      const removeBtn = row.querySelector("[data-remove]");

      removeBtn.addEventListener("click", () => removePin(url));

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
  });
}

function removePin(url) {
  chrome.storage.sync.get("storedTabs", (data) => {
    const storedTabs = data.storedTabs || {};

    delete storedTabs[url];

    const sortedUrls = Object.keys(storedTabs).sort(
      (a, b) => storedTabs[a] - storedTabs[b]
    );

    const normalized = {};
    sortedUrls.forEach((u, idx) => {
      normalized[u] = idx + 1;
    });

    chrome.storage.sync.set({ storedTabs: normalized }, loadTable);
  });
}

function loadOptions() {
  chrome.storage.sync.get({ autoTrackPinned: false }, (data) => {
    document.getElementById("autoTrackPinned").checked = data.autoTrackPinned;
  });
}

function saveOptions() {
  const autoTrackPinned = document.getElementById("autoTrackPinned").checked;
  chrome.storage.sync.set({ autoTrackPinned });
}


document.addEventListener("DOMContentLoaded", () => {
  loadOptions();
  loadTabs();
  document.getElementById("saveButton").addEventListener("click", saveOptions);
});
