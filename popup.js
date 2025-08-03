// Global references for event handlers
let promptHive;
let dbManager;

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", async () => {
  console.log('DOM loaded, initializing PromptHive...');
  try {
    // Initialize database manager first
    if (typeof PromptHiveDatabase !== 'undefined') {
      dbManager = new PromptHiveDatabase();
      await dbManager.init();
      console.log('Database manager initialized successfully');
    }
    promptHive = new PromptHive();
  } catch (error) {
    console.error('Failed to initialize database manager:', error);
    promptHive = new PromptHive();
  }
});
      // PromptHive Enhanced Popup Script with FIXED save functionality
class PromptHive {
  constructor() {
    this.prompts = [];
    this.editingIndex = null;
    this.filteredPrompts = [];
    this.dbManager = dbManager;
    this.currentPromptHistory = [];
    this.currentEnhancingIndex = null;
    this.stats = {
      totalPrompts: 0,
      totalTags: 0,
      totalUses: 0,
      avgUses: 0,
      mostUsedPrompt: null,
      categoryBreakdown: {},
      popularTags: []
    };
    this.init();
  }

  async init() {
    try {
      // Load prompts from database
      await this.loadPrompts();
      
      // Migrate old Chrome storage data if exists
      await this.migrateFromChromeStorage();
      
      // Bind events
      this.bindEvents();
      this.setupKeyboardShortcuts();
      
      console.log('PromptHive initialized successfully');
    } catch (error) {
      console.error('Failed to initialize PromptHive:', error);
      // Still bind events even if DB fails
      this.bindEvents();
      this.render();
    }
  }

  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('PromptHiveDB', 3);
      
      request.onerror = () => {
        console.error('Database failed to open:', request.error);
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('Database opened successfully');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('Database upgrade needed, creating/updating stores...');
        
        // Create prompts store with enhanced schema
        if (!db.objectStoreNames.contains('prompts')) {
          const promptStore = db.createObjectStore('prompts', { keyPath: 'id' });
          promptStore.createIndex('title', 'title', { unique: false });
          promptStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          promptStore.createIndex('createdAt', 'createdAt', { unique: false });
          promptStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          promptStore.createIndex('uses', 'uses', { unique: false });
          promptStore.createIndex('version', 'version', { unique: false });
        }
        
        // Create prompt history store
        if (!db.objectStoreNames.contains('promptHistory')) {
          const historyStore = db.createObjectStore('promptHistory', { keyPath: 'historyId' });
          historyStore.createIndex('promptId', 'promptId', { unique: false });
          historyStore.createIndex('version', 'version', { unique: false });
          historyStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Create categories store for better organization
        if (!db.objectStoreNames.contains('categories')) {
          const categoryStore = db.createObjectStore('categories', { keyPath: 'id' });
          categoryStore.createIndex('name', 'name', { unique: true });
          categoryStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Create settings store
        if (!db.objectStoreNames.contains('settings')) {
          const settingsStore = db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  async migrateFromChromeStorage() {
    try {
      const data = await chrome.storage.local.get("prompts");
      if (data.prompts && data.prompts.length > 0) {
        console.log('Migrating prompts from Chrome storage to IndexedDB...');
        
        for (const prompt of data.prompts) {
          // Enhance prompt with new fields if missing
          const enhancedPrompt = {
            ...prompt,
            id: prompt.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
            version: prompt.version || 1,
            createdAt: prompt.createdAt || new Date().toISOString(),
            updatedAt: prompt.updatedAt || new Date().toISOString(),
            uses: prompt.uses || 0,
            category: prompt.category || 'general'
          };
          await this.savePromptToDB(enhancedPrompt);
        }
        
        // Clear Chrome storage after migration
        await chrome.storage.local.remove("prompts");
        
        // Reload prompts from DB
        await this.loadPrompts();
        
        this.showNotification(`Migrated ${data.prompts.length} prompts to local database`);
      }
    } catch (error) {
      console.warn('Migration failed:', error);
    }
  }

  async loadPrompts() {
    try {
      if (!this.db) {
        console.warn('Database not initialized, using empty prompts array');
        this.prompts = [];
        this.filteredPrompts = [];
        this.render();
        return;
      }

      const transaction = this.db.transaction(['prompts'], 'readonly');
      const store = transaction.objectStore('prompts');
      
      return new Promise((resolve, reject) => {
        const request = store.getAll();
        
        request.onsuccess = () => {
          this.prompts = request.result.sort((a, b) => 
            new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
          );
          this.filteredPrompts = this.prompts;
          this.render();
          this.calculateStats(); // Calculate stats after loading
          this.updateStats();
          console.log(`Loaded ${this.prompts.length} prompts from database`);
          resolve();
        };
        
        request.onerror = () => {
          console.error('Error loading prompts:', request.error);
          this.prompts = [];
          this.filteredPrompts = [];
          this.render();
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('Error loading prompts:', error);
      this.prompts = [];
      this.filteredPrompts = [];
      this.render();
    }
  }

  calculateStats() {
    const allTags = new Set();
    let totalUses = 0;
    const categoryBreakdown = {};
    const tagCount = {};

    this.prompts.forEach(prompt => {
      // Count total uses
      totalUses += prompt.uses || 0;

      // Collect unique tags
      prompt.tags.forEach(tag => {
        allTags.add(tag);
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      });

      // Category breakdown
      const category = prompt.category || 'general';
      categoryBreakdown[category] = (categoryBreakdown[category] || 0) + 1;
    });

    // Find most used prompt
    const mostUsedPrompt = this.prompts.reduce((max, prompt) => 
      (prompt.uses || 0) > (max.uses || 0) ? prompt : max, 
      this.prompts[0] || null
    );

    // Get popular tags (top 10 by usage)
    const popularTags = Object.entries(tagCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    this.stats = {
      totalPrompts: this.prompts.length,
      totalTags: allTags.size,
      totalUses: totalUses,
      avgUses: this.prompts.length > 0 ? Math.round(totalUses / this.prompts.length * 10) / 10 : 0,
      mostUsedPrompt: mostUsedPrompt,
      categoryBreakdown: categoryBreakdown,
      popularTags: popularTags
    };
  }

  async savePromptToDB(prompt) {
    if (!this.db) {
      console.warn('Database not initialized, skipping DB save');
      return false;
    }

    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['prompts'], 'readwrite');
        const store = transaction.objectStore('prompts');
        const request = store.put(prompt);
        
        request.onsuccess = () => {
          console.log('Prompt saved successfully to DB:', prompt.id);
          resolve(true);
        };
        
        request.onerror = () => {
          console.error('Error saving prompt to DB:', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          console.error('Transaction error:', transaction.error);
          reject(transaction.error);
        };
      } catch (error) {
        console.error('Exception in savePromptToDB:', error);
        reject(error);
      }
    });
  }

  async savePromptHistory(promptId, oldPrompt, version) {
    if (!this.db) {
      console.warn('Database not initialized, skipping history save');
      return;
    }

    const historyEntry = {
      historyId: `${promptId}_v${version}_${Date.now()}`,
      promptId: promptId,
      version: version,
      title: oldPrompt.title,
      text: oldPrompt.text,
      tags: oldPrompt.tags,
      createdAt: new Date().toISOString(),
      originalDate: oldPrompt.date,
      originalUses: oldPrompt.uses
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['promptHistory'], 'readwrite');
      const store = transaction.objectStore('promptHistory');
      const request = store.put(historyEntry);
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPromptHistory(promptId) {
    if (!this.db) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['promptHistory'], 'readonly');
      const store = transaction.objectStore('promptHistory');
      const index = store.index('promptId');
      const request = index.getAll(promptId);
      
      request.onsuccess = () => {
        const history = request.result.sort((a, b) => b.version - a.version);
        resolve(history);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async enhanceWithAI(text) {
    // Mock AI enhancement - replace with actual AI API call
    return new Promise((resolve) => {
      setTimeout(() => {
        const enhanced = this.mockAIEnhancement(text);
        resolve(enhanced);
      }, 1500);
    });
  }

  mockAIEnhancement(text) {
    // Enhanced mock AI enhancement
    const enhancements = [
      "Optimize for clarity and effectiveness:",
      "Add context and specific examples to:",
      "Improve structure and actionability of:",
      "Make this more professional and detailed:",
      "Enhance with step-by-step guidance:"
    ];
    
    const suggestions = [
      "• Include specific examples and use cases",
      "• Add measurable outcomes and success criteria",
      "• Provide step-by-step implementation guide",
      "• Consider different scenarios and edge cases",
      "• Include relevant context and background information",
      "• Add troubleshooting tips and common pitfalls"
    ];
    
    const randomEnhancement = enhancements[Math.floor(Math.random() * enhancements.length)];
    const selectedSuggestions = suggestions
      .sort(() => 0.5 - Math.random())
      .slice(0, 4);
    
    return `${randomEnhancement}\n\n${text}\n\nAI Recommendations:\n${selectedSuggestions.join('\n')}`;
  }

  bindEvents() {
    try {
      // Search functionality
      const searchInput = document.getElementById("searchInput");
      if (searchInput) {
        searchInput.addEventListener("input", (e) => {
          this.search(e.target.value);
        });
      }

      // Add prompt button
      const addPromptBtn = document.getElementById("addPromptBtn");
      if (addPromptBtn) {
        addPromptBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openModal();
        });
      }

      // Export button
      const exportBtn = document.getElementById("exportBtn");
      if (exportBtn) {
        exportBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.exportToCSV();
        });
      }

      // Dashboard button
      const dashboardBtn = document.getElementById("dashboardBtn");
      if (dashboardBtn) {
        dashboardBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openDashboard();
        });
      }

      // FIXED: Modal events - Proper event listener management
      this.bindModalEvents();

      console.log('Events bound successfully');
    } catch (error) {
      console.error('Error binding events:', error);
    }
  }

  // FIXED: Separate method for modal event binding to avoid duplicates
  bindModalEvents() {
    // Save prompt button - FIXED: Remove existing listeners first
    const savePromptBtn = document.getElementById("savePromptBtn");
    if (savePromptBtn) {
      // Clone to remove all existing listeners
      const newSaveBtn = savePromptBtn.cloneNode(true);
      savePromptBtn.parentNode.replaceChild(newSaveBtn, savePromptBtn);
      
      // Add fresh listener
      newSaveBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Disable button to prevent double-clicks
        newSaveBtn.disabled = true;
        const originalText = newSaveBtn.textContent;
        newSaveBtn.textContent = 'Saving...';
        
        try {
          await this.savePrompt();
        } finally {
          // Re-enable button
          newSaveBtn.disabled = false;
          newSaveBtn.textContent = originalText;
        }
      });
    }

    const cancelBtn = document.getElementById("cancelBtn");
    if (cancelBtn) {
      // Remove existing listeners
      const newCancelBtn = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
      
      newCancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeModal();
      });
    }

    // Enhancement modal events
    const keepOriginalBtn = document.getElementById("keepOriginalBtn");
    if (keepOriginalBtn) {
      const newKeepOriginalBtn = keepOriginalBtn.cloneNode(true);
      keepOriginalBtn.parentNode.replaceChild(newKeepOriginalBtn, keepOriginalBtn);
      
      newKeepOriginalBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.useOriginalPrompt();
      });
    }

    const keepEnhancedBtn = document.getElementById("keepEnhancedBtn");
    if (keepEnhancedBtn) {
      const newKeepEnhancedBtn = keepEnhancedBtn.cloneNode(true);
      keepEnhancedBtn.parentNode.replaceChild(newKeepEnhancedBtn, keepEnhancedBtn);
      
      newKeepEnhancedBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.useEnhancedPrompt();
      });
    }

    const cancelEnhancementBtn = document.getElementById("cancelEnhancementBtn");
    if (cancelEnhancementBtn) {
      const newCancelEnhancementBtn = cancelEnhancementBtn.cloneNode(true);
      cancelEnhancementBtn.parentNode.replaceChild(newCancelEnhancementBtn, cancelEnhancementBtn);
      
      newCancelEnhancementBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeEnhancementModal();
      });
    }

    // History modal events
    const closeHistoryBtn = document.getElementById("closeHistoryBtn");
    if (closeHistoryBtn) {
      const newCloseHistoryBtn = closeHistoryBtn.cloneNode(true);
      closeHistoryBtn.parentNode.replaceChild(newCloseHistoryBtn, closeHistoryBtn);
      
      newCloseHistoryBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeHistoryModal();
      });
    }

    // Dashboard modal events
    const closeDashboardBtn = document.getElementById("closeDashboardBtn");
    if (closeDashboardBtn) {
      const newCloseDashboardBtn = closeDashboardBtn.cloneNode(true);
      closeDashboardBtn.parentNode.replaceChild(newCloseDashboardBtn, closeDashboardBtn);
      
      newCloseDashboardBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.closeDashboard();
      });
    }

    // Modal overlay clicks to close
    const modalOverlay = document.getElementById("modalOverlay");
    if (modalOverlay) {
      // Remove existing listeners
      const newModalOverlay = modalOverlay.cloneNode(true);
      modalOverlay.parentNode.replaceChild(newModalOverlay, modalOverlay);
      
      newModalOverlay.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
          this.closeModal();
        }
      });
    }

    // Similar treatment for other modal overlays
    this.bindModalOverlayEvents();
  }

  bindModalOverlayEvents() {
    const enhancementModalOverlay = document.getElementById("enhancementModalOverlay");
    if (enhancementModalOverlay) {
      const newEnhancementModalOverlay = enhancementModalOverlay.cloneNode(true);
      enhancementModalOverlay.parentNode.replaceChild(newEnhancementModalOverlay, enhancementModalOverlay);
      
      newEnhancementModalOverlay.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
          this.closeEnhancementModal();
        }
      });
    }

    const historyModalOverlay = document.getElementById("historyModalOverlay");
    if (historyModalOverlay) {
      const newHistoryModalOverlay = historyModalOverlay.cloneNode(true);
      historyModalOverlay.parentNode.replaceChild(newHistoryModalOverlay, historyModalOverlay);
      
      newHistoryModalOverlay.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
          this.closeHistoryModal();
        }
      });
    }

    const dashboardModalOverlay = document.getElementById("dashboardModalOverlay");
    if (dashboardModalOverlay) {
      const newDashboardModalOverlay = dashboardModalOverlay.cloneNode(true);
      dashboardModalOverlay.parentNode.replaceChild(newDashboardModalOverlay, dashboardModalOverlay);
      
      newDashboardModalOverlay.addEventListener("click", (e) => {
        if (e.target === e.currentTarget) {
          this.closeDashboard();
        }
      });
    }
  }
}