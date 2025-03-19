const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'api', {
    login: async (credentials) => {
      return await ipcRenderer.invoke('login', credentials);
    },

    getProjects: async () => {
      return await ipcRenderer.invoke('get-projects');
    },

    cloneProject: async (projectId, path) => {
      return await ipcRenderer.invoke('clone-project', { projectId, path });
    },

    pullChanges: async (projectId) => {
      return await ipcRenderer.invoke('pull-changes', { projectId });
    },

    commitChanges: async (projectId, message, files) => {
      return await ipcRenderer.invoke('commit-changes', { 
        projectId,
        message,
        files
      });
    },

    onFileChange: (callback) => {
      ipcRenderer.on('file-change', (event, data) => callback(data));
    },

    removeFileChangeListener: () => {
      ipcRenderer.removeAllListeners('file-change');
    }
  }
);

