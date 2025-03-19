const { ipcRenderer } = require('electron');
let currentProject = null;
let isAuthenticated = false;

// Handle login
async function login(credentials) {
  try {
    const result = await ipcRenderer.invoke('login', credentials);
    isAuthenticated = true;
    return result;
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
}

// Get projects
async function getProjects() {
  try {
    return await ipcRenderer.invoke('get-projects');
  } catch (err) {
    console.error('Error fetching projects:', err);
    throw err;
  }
}

// Clone project
async function cloneProject(projectId, path) {
  try {
    return await ipcRenderer.invoke('clone-project', { projectId, path });
  } catch (err) {
    console.error('Error cloning project:', err);
    throw err;
  }
}

// Pull changes
async function pullChanges(projectId) {
  try {
    return await ipcRenderer.invoke('pull-changes', { projectId });
  } catch (err) {
    console.error('Error pulling changes:', err);
    throw err;
  }
}

// Commit changes
async function commitChanges(projectId, message, files) {
  try {
    return await ipcRenderer.invoke('commit-changes', {
      projectId,
      message,
      files
    });
  } catch (err) {
    console.error('Error committing changes:', err);
    throw err;
  }
}

// Listen for file changes
ipcRenderer.on('file-change', (event, data) => {
  if (!currentProject) return;
  
  // Update UI to reflect file changes
  const fileList = document.getElementById('fileList');
  if (!fileList) return;

  const fileItem = document.createElement('div');
  fileItem.className = 'file-item';
  
  const status = document.createElement('span');
  status.className = `file-status status-${data.type}`;
  status.textContent = data.type;
  
  const name = document.createElement('span');
  name.textContent = data.path;
  
  fileItem.appendChild(status);
  fileItem.appendChild(name);
  fileList.appendChild(fileItem);
});
