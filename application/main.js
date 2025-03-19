const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const chokidar = require('chokidar');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');

// Server config
const SERVER_URL = process.env.SERVER_URL || 'https://musichub.cc';
let mainWindow;
let projectWatcher;
let currentProject;
let isAuthenticated = false;

// Create main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle login
ipcMain.handle('login', async (event, credentials) => {
  try {
    const response = await axios.post(`${SERVER_URL}/api/login`, credentials);
    isAuthenticated = true;
    return response.data;
  } catch (err) {
    console.error('Login error:', err);
    throw err;
  }
});

// Get user projects
ipcMain.handle('get-projects', async () => {
  try {
    const response = await axios.get(`${SERVER_URL}/api/projects`);
    return response.data;
  } catch (err) {
    console.error('Error fetching projects:', err);
    throw err;
  }
});

// Watch project directory for changes
async function watchProject(projectPath) {
  if (projectWatcher) {
    projectWatcher.close();
  }

  projectWatcher = chokidar.watch(projectPath, {
    ignored: /(^|[\/\\])\../, // Ignore hidden files
    persistent: true
  });

  projectWatcher
    .on('add', path => handleFileChange('add', path))
    .on('change', path => handleFileChange('change', path))
    .on('unlink', path => handleFileChange('delete', path));
}

// Handle file changes
async function handleFileChange(type, filePath) {
  if (!currentProject || !isAuthenticated) return;

  try {
    const fileContent = type !== 'delete' ? fs.readFileSync(filePath) : null;
    const stats = type !== 'delete' ? fs.statSync(filePath) : null;

    mainWindow.webContents.send('file-change', {
      type,
      path: filePath,
      content: fileContent,
      stats
    });
  } catch (err) {
    console.error('Error handling file change:', err);
  }
}

// Commit changes
ipcMain.handle('commit-changes', async (event, { projectId, message, files }) => {
  try {
    const formData = new FormData();
    formData.append('message', message);
    
    files.forEach(file => {
      formData.append('files', fs.createReadStream(file.path));
    });

    const response = await axios.post(
      `${SERVER_URL}/api/projects/${projectId}/versions`, 
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      }
    );

    return response.data;
  } catch (err) {
    console.error('Error committing changes:', err);
    throw err;
  }
});

// Clone project
ipcMain.handle('clone-project', async (event, { projectId, path }) => {
  try {
    const response = await axios.get(`${SERVER_URL}/api/projects/${projectId}`);
    const project = response.data;

    // Clone using isomorphic-git
    await git.clone({
      fs,
      http,
      dir: path,
      url: project.gitUrl,
      ref: 'main',
      singleBranch: true,
      depth: 1
    });

    currentProject = {
      id: projectId,
      path
    };

    // Start watching project directory
    await watchProject(path);

    return { success: true };
  } catch (err) {
    console.error('Error cloning project:', err);
    throw err;
  }
});

// Pull latest changes
ipcMain.handle('pull-changes', async (event, { projectId }) => {
  try {
    if (!currentProject || currentProject.id !== projectId) {
      throw new Error('No active project');
    }

    await git.pull({
      fs,
      http,
      dir: currentProject.path,
      ref: 'main',
      singleBranch: true
    });

    return { success: true };
  } catch (err) {
    console.error('Error pulling changes:', err);
    throw err;
  }
});

