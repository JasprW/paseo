(function () {
  if (window.paseoDesktop) {
    return;
  }

  function tauri() {
    var api = window.__TAURI__;
    if (!api || !api.core || typeof api.core.invoke !== "function") {
      throw new Error("Tauri API is unavailable.");
    }
    return api;
  }

  function invoke(command, args) {
    return tauri().core.invoke(command, args || {});
  }

  function listen(event, handler) {
    var api = tauri();
    if (!api.event || typeof api.event.listen !== "function") {
      throw new Error("Tauri event API is unavailable.");
    }
    return api.event.listen(event, function (payload) {
      handler(
        payload && Object.prototype.hasOwnProperty.call(payload, "payload")
          ? payload.payload
          : payload,
      );
    });
  }

  function isInteractiveDragTarget(target) {
    if (!target || target.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    return Boolean(
      target.closest(
        [
          "[data-tauri-drag-region='false']",
          "a",
          "button",
          "input",
          "select",
          "textarea",
          "summary",
          "[contenteditable='true']",
          "[role='button']",
          "[role='menuitem']",
          "[role='tab']",
          "[role='textbox']",
        ].join(","),
      ),
    );
  }

  function isInTauriDragRegion(event) {
    if (isInteractiveDragTarget(event.target)) {
      return false;
    }

    if (typeof document.elementsFromPoint !== "function") {
      return false;
    }

    var elements = document.elementsFromPoint(event.clientX, event.clientY);
    for (var index = 0; index < elements.length; index += 1) {
      var element = elements[index];
      if (!element || typeof element.getAttribute !== "function") {
        continue;
      }
      var region = element.getAttribute("data-tauri-drag-region");
      if (region === "false") {
        return false;
      }
      if (region !== null) {
        return true;
      }
    }
    return false;
  }

  function installTauriDragBridge() {
    document.addEventListener(
      "mousedown",
      function (event) {
        if (event.button !== 0 || !isInTauriDragRegion(event)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.detail === 2) {
          void invoke("window_toggle_maximize");
          return;
        }

        void invoke("window_start_dragging");
      },
      true,
    );
  }

  var platform = "unknown";
  if (navigator.userAgent.indexOf("Mac OS") >= 0 || navigator.userAgent.indexOf("Macintosh") >= 0) {
    platform = "darwin";
  } else if (navigator.userAgent.indexOf("Windows") >= 0) {
    platform = "win32";
  } else if (navigator.userAgent.indexOf("Linux") >= 0) {
    platform = "linux";
  }

  window.paseoDesktop = {
    platform: platform,
    invoke: function (command, args) {
      return invoke("paseo_invoke", { command: command, args: args || null });
    },
    getPendingOpenProject: function () {
      return invoke("get_pending_open_project");
    },
    events: {
      on: function (event, handler) {
        return listen("paseo:event:" + event, handler);
      },
    },
    window: {
      getCurrentWindow: function () {
        return {
          label: "main",
          toggleMaximize: function () {
            return invoke("window_toggle_maximize");
          },
          isFullscreen: function () {
            return invoke("window_is_fullscreen");
          },
          updateWindowControls: function (update) {
            return invoke("window_update_controls", { update: update || null });
          },
          onResized: function (handler) {
            return listen("paseo:window:resized", handler);
          },
          setBadgeCount: function (count) {
            return invoke("window_set_badge_count", {
              count: typeof count === "number" ? count : null,
            });
          },
        };
      },
    },
    dialog: {
      ask: function (message, options) {
        return invoke("dialog_ask", { message: message, options: options || null });
      },
      open: function (options) {
        return invoke("dialog_open", { options: options || null });
      },
    },
    notification: {
      isSupported: function () {
        return invoke("notification_is_supported");
      },
      sendNotification: function (payload) {
        return invoke("notification_send", { payload: payload || null });
      },
    },
    opener: {
      openUrl: function (url) {
        return invoke("open_url", { url: url });
      },
    },
    menu: {
      showContextMenu: function (input) {
        return invoke("menu_show_context_menu", { input: input || null });
      },
    },
  };

  installTauriDragBridge();
})();
