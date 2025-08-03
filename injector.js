// Enhanced Content script for prompt detection and saving with AI enhancement
class PromptInjector {
  constructor() {
    this.isEnabled = true;
    this.selectedText = "";
    this.db = null;
    this.init();
  }

  async init() {
    await this.initDB();
    this.addSelectionListener();
    this.addFloatingButton();
    this.detectAIChats();
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PromptHiveDB', 2);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create prompts store
        if (!db.objectStoreNames.contains('prompts')) {
          const promptStore = db.createObjectStore('prompts', { keyPath: 'id' });
          promptStore.createIndex('title', 'title', { unique: false });
          promptStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          promptStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        // Create prompt history store
        if (!db.objectStoreNames.contains('promptHistory')) {
          const historyStore = db.createObjectStore('promptHistory', { keyPath: 'historyId' });
          historyStore.createIndex('promptId', 'promptId', { unique: false });
          historyStore.createIndex('version', 'version', { unique: false });
          historyStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  addSelectionListener() {
    document.addEventListener("mouseup", (e) => {
      if (!this.isEnabled) return;

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText.length > 10) {
        this.selectedText = selectedText;
        this.showFloatingButton(e.pageX, e.pageY);
      } else {
        this.hideFloatingButton();
      }
    });

    // Hide floating button when clicking elsewhere
    document.addEventListener("mousedown", (e) => {
      if (!e.target.closest("#prompthive-floating-btn")) {
        this.hideFloatingButton();
      }
    });
  }

  addFloatingButton() {
    const button = document.createElement("div");
    button.id = "prompthive-floating-btn";
    button.innerHTML = `
      <div class="prompthive-btn-content">
        <span class="prompthive-icon">🏠</span>
        <span class="prompthive-text">Save to PromptHive</span>
      </div>
    `;
    button.style.display = "none";
    document.body.appendChild(button);

    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.saveSelectedText();
    });
  }

  showFloatingButton(x, y) {
    const button = document.getElementById("prompthive-floating-btn");
    if (!button) return;

    button.style.display = "block";
    button.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    button.style.top = `${Math.max(y - 50, 10)}px`;
  }

  hideFloatingButton() {
    const button = document.getElementById("prompthive-floating-btn");
    if (button) {
      button.style.display = "none";
    }
  }

  async saveSelectedText() {
    if (!this.selectedText) return;

    const prompt = {
      id: Date.now().toString(),
      title: `Saved from ${document.title}`,
      text: this.selectedText,
      tags: ["auto-saved", this.detectPageType()],
      date: new Date().toLocaleDateString(),
      uses: 0,
      version: 1,
      source: window.location.href,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      // Save to IndexedDB directly
      await this.savePromptToDB(prompt);
      
      // Also send to background script for backup
      chrome.runtime.sendMessage({
        action: "savePrompt",
        prompt: prompt
      });

      this.showSaveNotification();
    } catch (error) {
      console.error('Failed to save prompt:', error);
      this.showErrorNotification();
    }

    this.hideFloatingButton();
    window.getSelection().removeAllRanges();
  }

  async savePromptToDB(prompt) {
    if (!this.db) {
      await this.initDB();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['prompts'], 'readwrite');
      const store = transaction.objectStore('prompts');
      const request = store.put(prompt);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  detectPageType() {
    const hostname = window.location.hostname.toLowerCase();
    const url = window.location.href.toLowerCase();

    if (hostname.includes("openai.com") || hostname.includes("chat.openai")) {
      return "chatgpt";
    } else if (hostname.includes("claude.ai")) {
      return "claude";
    } else if (hostname.includes("bard.google")) {
      return "bard";
    } else if (hostname.includes("github.com")) {
      return "github";
    } else if (hostname.includes("stackoverflow.com")) {
      return "stackoverflow";
    } else if (url.includes("reddit.com")) {
      return "reddit";
    } else if (hostname.includes("medium.com")) {
      return "medium";
    } else if (hostname.includes("perplexity.ai")) {
      return "perplexity";
    } else if (hostname.includes("gemini.google")) {
      return "gemini";
    } else {
      return "web";
    }
  }

  detectAIChats() {
    // Enhanced detection for AI chat interfaces
    const hostname = window.location.hostname;
    
    if (hostname.includes("openai.com")) {
      this.enhanceChatGPT();
    } else if (hostname.includes("claude.ai")) {
      this.enhanceClaude();
    } else if (hostname.includes("bard.google") || hostname.includes("gemini.google")) {
      this.enhanceGemini();
    } else if (hostname.includes("perplexity.ai")) {
      this.enhancePerplexity();
    }
  }

  enhanceChatGPT() {
    // Add save buttons to ChatGPT messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToChatGPT(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial scan
    this.addSaveButtonsToChatGPT(document.body);
  }

  enhanceClaude() {
    // Add save buttons to Claude messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToClaude(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Initial scan
    this.addSaveButtonsToClaude(document.body);
  }

  enhanceGemini() {
    // Add save buttons to Gemini messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToGemini(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  enhancePerplexity() {
    // Add save buttons to Perplexity messages
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.addSaveButtonsToPerplexity(node);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  addSaveButtonsToChatGPT(container) {
    // Look for message containers in ChatGPT
    const messages = container.querySelectorAll('[data-message-author-role="assistant"], .markdown');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      const messageContent = message.querySelector(".prose, .markdown") || message;
      
      if (messageContent && messageContent.textContent.trim().length > 50) {
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(messageContent.textContent, "ChatGPT Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  addSaveButtonsToClaude(container) {
    // Look for message containers in Claude
    const messages = container.querySelectorAll('[data-testid="message"], .font-claude-message');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      const messageContent = message.querySelector(".prose, .markdown") || message;
      
      if (messageContent && messageContent.textContent.trim().length > 50) {
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(messageContent.textContent, "Claude Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  addSaveButtonsToGemini(container) {
    // Look for message containers in Gemini
    const messages = container.querySelectorAll('[data-test-id="model-response"], .model-response-text');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      
      if (message.textContent.trim().length > 50) {
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(message.textContent, "Gemini Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  addSaveButtonsToPerplexity(container) {
    // Look for message containers in Perplexity
    const messages = container.querySelectorAll('.prose, [class*="answer"]');
    messages.forEach((message) => {
      if (message.querySelector(".prompthive-inline-btn")) return;

      const saveBtn = this.createInlineSaveButton();
      
      if (message.textContent.trim().length > 50) {
        saveBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.saveMessageContent(message.textContent, "Perplexity Response");
        });
        
        // Position the button
        message.style.position = 'relative';
        message.appendChild(saveBtn);
      }
    });
  }

  createInlineSaveButton() {
    const button = document.createElement("button");
    button.className = "prompthive-inline-btn";
    button.innerHTML = `
      <span class="prompthive-icon">🏠</span>
      <span>Save</span>
    `;
    return button;
  }

  async saveMessageContent(content, title) {
    const prompt = {
      id: Date.now().toString(),
      title: title,
      text: content,
      tags: ["ai-response", this.detectPageType()],
      date: new Date().toLocaleDateString(),
      uses: 0,
      version: 1,
      source: window.location.href,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      // Save to IndexedDB directly
      await this.savePromptToDB(prompt);
      
      // Also send to background script
      chrome.runtime.sendMessage({
        action: "savePrompt",
        prompt: prompt
      });

      this.showSaveNotification();
    } catch (error) {
      console.error('Failed to save message:', error);
      this.showErrorNotification();
    }
  }

  showSaveNotification() {
    // Create and show a temporary notification
    const notification = document.createElement("div");
    notification.className = "prompthive-notification";
    notification.innerHTML = `
      <div class="prompthive-notification-content">
        <span class="prompthive-icon">✅</span>
        <span>Saved to PromptHive!</span>
      </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.classList.add("show");
    }, 100);

    // Remove after 3 seconds
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  showErrorNotification() {
    // Create and show an error notification
    const notification = document.createElement("div");
    notification.className = "prompthive-notification error";
    notification.innerHTML = `
      <div class="prompthive-notification-content">
        <span class="prompthive-icon">❌</span>
        <span>Failed to save prompt!</span>
      </div>
    `;

    // Add error styling
    notification.style.background = "linear-gradient(135deg, #ef4444, #dc2626)";

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
      notification.classList.add("show");
    }, 100);

    // Remove after 4 seconds (longer for error)
    setTimeout(() => {
      notification.classList.remove("show");
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 4000);
  }
}

// Initialize when page loads
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new PromptInjector();
  });
} else {
  new PromptInjector();
}