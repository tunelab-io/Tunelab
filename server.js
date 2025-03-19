const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const path = require('path');
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const bcrypt = require('bcryptjs');
const { exec } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const os = require('os');
const { marked } = require('marked');
const git = require('isomorphic-git');
const http2 = require('isomorphic-git/http/node');
const { v4: uuidv4 } = require('uuid');

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://appleidmusic960:Dataking8@tapsidecluster.oeofi.mongodb.net/musichub', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Configure DigitalOcean Spaces
const spacesEndpoint = new AWS.Endpoint(process.env.SPACES_ENDPOINT || 'nyc3.digitaloceanspaces.com');
const s3 = new AWS.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.SPACES_ACCESS_KEY_ID,
  secretAccessKey: process.env.SPACES_SECRET_ACCESS_KEY,
  region: process.env.SPACES_REGION || 'nyc3'
});

// Configure Git repository settings
const GIT_SERVER = process.env.GIT_SERVER || 'https://rythmit.com/git';
const GIT_USERNAME = process.env.GIT_USERNAME;
const GIT_PASSWORD = process.env.GIT_PASSWORD;

// Configure Multer for file uploads to DigitalOcean Spaces
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.SPACES_BUCKET_NAME || 'rythmit-files',
    acl: 'private',
    metadata: function (req, file, cb) {
      cb(null, { fieldName: file.fieldname });
    },
    key: function (req, file, cb) {
      const filename = `${req.session.userId}/${Date.now()}-${file.originalname}`;
      cb(null, filename);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB file size limit
});

// Git operations helper functions
const gitHelpers = {
  async initRepo(projectPath) {
    await git.init({
      fs,
      dir: projectPath,
      defaultBranch: 'main'
    });
  },

  async addRemote(projectPath, remoteUrl) {
    await git.addRemote({
      fs,
      dir: projectPath,
      remote: 'origin',
      url: remoteUrl,
      force: true
    });
  },

  async commit(projectPath, message, author) {
    await git.add({
      fs,
      dir: projectPath,
      filepath: '.'
    });

    await git.commit({
      fs,
      dir: projectPath,
      message,
      author: {
        name: author.username,
        email: author.email
      }
    });
  },

  async push(projectPath) {
    await git.push({
      fs,
      http: http2,
      dir: projectPath,
      remote: 'origin',
      ref: 'main',
      onAuth: () => ({
        username: GIT_USERNAME,
        password: GIT_PASSWORD
      })
    });
  },

  async pull(projectPath) {
    await git.pull({
      fs,
      http: http2,
      dir: projectPath,
      remote: 'origin',
      ref: 'main',
      onAuth: () => ({
        username: GIT_USERNAME,
        password: GIT_PASSWORD
      })
    });
  },

  async clone(remoteUrl, projectPath) {
    await git.clone({
      fs,
      http: http2,
      dir: projectPath,
      url: remoteUrl,
      onAuth: () => ({
        username: GIT_USERNAME,
        password: GIT_PASSWORD
      })
    });
  }
};

// Set up session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'rythmit_secret_key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI || 'mongodb+srv://appleidmusic960:Dataking8@tapsidecluster.oeofi.mongodb.net/musichub' }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
}));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Set EJS as view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  plan: { type: String, enum: ['free', 'pro', 'team'], default: 'free' },
  storageUsed: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  bio: { type: String, default: '' },
  profileImage: { type: String },
  location: { type: String },
  website: { type: String },
  socialLinks: {
    twitter: { type: String },
    instagram: { type: String },
    soundcloud: { type: String }
  },
  notifications: {
    email: { type: Boolean, default: true },
    projectUpdates: { type: Boolean, default: true },
    collaborationRequests: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false }
  },
  readme: { type: String },
  readmeHtml: { type: String },
  followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  avatar: { type: String }
});

const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  collaborators: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: { type: String, enum: ['admin', 'producer', 'vocalist', 'mixer'] }
  }],
  isPublic: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  genre: { type: String, enum: ['rock', 'pop', 'electronic', 'hiphop', 'jazz', 'classical', 'other'] },
  gitRepoUrl: { type: String },
  gitRepoPath: { type: String },
  versions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Version' }] // Add this line
});

const VersionSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String, required: true },
  files: [{
    originalName: String,
    s3Key: String,
    fileType: String,
    size: Number
  }],
  branch: { type: String, default: 'main' },
  parentVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'Version' },
  createdAt: { type: Date, default: Date.now },
  commitHash: { type: String }
});

const CommentSchema = new mongoose.Schema({
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  version: { type: mongoose.Schema.Types.ObjectId, ref: 'Version' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  timestamp: { type: Number }, // For timestamped comments on audio
  createdAt: { type: Date, default: Date.now }
});

const ActivitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['project_created', 'project_updated', 'comment_added', 'followed_user'] },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const NotificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, required: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  message: { type: String },
  isRead: { type: Boolean, default: false },
  seen: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.model('User', UserSchema);
const Project = mongoose.model('Project', ProjectSchema);
const Version = mongoose.model('Version', VersionSchema);
const Comment = mongoose.model('Comment', CommentSchema);
const Activity = mongoose.model('Activity', ActivitySchema);
const Notification = mongoose.model('Notification', NotificationSchema);

// Authentication middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
};

// Check storage limits middleware
const checkStorageLimit = async (req, res, next) => {
  try {
    const user = await User.findById(req.session.userId);
    
    let storageLimit;
    switch(user.plan) {
      case 'free':
        storageLimit = 1 * 1024 * 1024 * 1024; // 1GB
        break;
      case 'pro':
        storageLimit = 50 * 1024 * 1024 * 1024; // 50GB
        break;
      case 'team':
        storageLimit = 500 * 1024 * 1024 * 1024; // 500GB
        break;
      default:
        storageLimit = 1 * 1024 * 1024 * 1024; // 1GB default
    }
    
    // Calculate file sizes from request
    const filesToUpload = req.files || [];
    const totalUploadSize = filesToUpload.reduce((sum, file) => sum + file.size, 0);
    
    if (user.storageUsed + totalUploadSize > storageLimit) {
      return res.status(400).json({ error: 'Storage limit exceeded' });
    }
    
    next();
  } catch (err) {
    console.error('Storage check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// Routes - User Profile and Settings
app.get('/profile', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const projects = await Project.find({ owner: req.session.userId }).sort({ updatedAt: -1 }).limit(5);
    const collaborations = await Project.find({ 'collaborators.user': req.session.userId }).sort({ updatedAt: -1 }).limit(5);
    
    res.render('profile', { 
      user, 
      projects,
      collaborations,
      storageUsed: (user.storageUsed / (1024 * 1024)).toFixed(2) // Convert to MB
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/settings', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    
    // Calculate storage usage percentage based on plan
    let storageLimit;
    switch(user.plan) {
      case 'free':
        storageLimit = 1 * 1024 * 1024 * 1024; // 1GB
        break;
      case 'pro':
        storageLimit = 50 * 1024 * 1024 * 1024; // 50GB
        break;
      case 'team':
        storageLimit = 500 * 1024 * 1024 * 1024; // 500GB
        break;
      default:
        storageLimit = 1 * 1024 * 1024 * 1024; // 1GB default
    }
    
    const storagePercentage = ((user.storageUsed / storageLimit) * 100).toFixed(2);
    
    res.render('settings', { 
      user,
      storageUsed: (user.storageUsed / (1024 * 1024)).toFixed(2), // Convert to MB
      storageLimit: (storageLimit / (1024 * 1024 * 1024)).toFixed(2), // Convert to GB
      storagePercentage
    });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/settings/profile', isAuthenticated, upload.single('profileImage'), async (req, res) => {
  try {
    const { username, email, bio, location, website } = req.body;
    
    // Check if username or email is already taken by another user
    if (username !== undefined) {
      const existingUser = await User.findOne({ 
        username, 
        _id: { $ne: req.session.userId } 
      });
      
      if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }
    
    if (email !== undefined) {
      const existingUser = await User.findOne({ 
        email, 
        _id: { $ne: req.session.userId } 
      });
      
      if (existingUser) {
        return res.status(400).json({ error: 'Email already taken' });
      }
    }
    
    // Prepare update object
    const updateData = {
      username,
      email,
      bio,
      location,
      website
    };
    
    // Add profile image if uploaded
    if (req.file) {
      updateData.profileImage = req.file.key;
      updateData.avatar = req.file.key;
    }
    
    // Update user
    await User.findByIdAndUpdate(req.session.userId, updateData);
    
    res.redirect('/settings?success=profile-updated');
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/settings/notifications', isAuthenticated, async (req, res) => {
  try {
    const { emailNotifications, projectUpdates, collaborationRequests, marketingEmails } = req.body;
    
    // Update notifications settings
    await User.findByIdAndUpdate(req.session.userId, {
      'notifications.email': !!emailNotifications,
      'notifications.projectUpdates': !!projectUpdates,
      'notifications.collaborationRequests': !!collaborationRequests,
      'notifications.marketing': !!marketingEmails
    });
    
    res.redirect('/settings?success=notifications-updated');
  } catch (err) {
    console.error('Notifications update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.get('/help', (req, res) => {
  try {
    res.render('help', {
      title: 'Help & Support',
      user: req.session.user || null,
      activeTab: 'help'
    });
  } catch (err) {
    console.error('Help page error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/settings/password', isAuthenticated, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Validate passwords
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }
    
    // Get user
    const user = await User.findById(req.session.userId);
    
    // Verify current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    
    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);
    
    // Update password
    await User.findByIdAndUpdate(req.session.userId, { password: hashedPassword });
    
    res.redirect('/settings?success=password-updated');
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/settings/upgrade-plan', isAuthenticated, async (req, res) => {
  try {
    const { plan } = req.body;
    
    // Validate plan
    if (!['free', 'pro', 'team'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }
    
    // In a real app, you would process payment here
    
    // Update user plan
    await User.findByIdAndUpdate(req.session.userId, { plan });
    
    res.redirect('/settings?success=plan-upgraded');
  } catch (err) {
    console.error('Plan upgrade error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
app.get('/projects/:id/versions/new', isAuthenticated, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner')
      .populate('collaborators');

    if (!project) {
      return res.status(404).render('error', { message: 'Project not found' });
    }

    // Check if user has permission to create versions
    const isOwner = project.owner._id.toString() === req.session.userId;
    const isCollaborator = project.collaborators.some(c => c._id.toString() === req.session.userId);

    if (!isOwner && !isCollaborator) {
      return res.status(403).render('error', { message: 'You do not have permission to create versions for this project' });
    }

    // Get current user
    const currentUser = await User.findById(req.session.userId);

    res.render('new-version', {
      project,
      currentUser
    });

  } catch (err) {
    console.error('New version page error:', err);
    res.status(500).render('error', { message: 'Server error' });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    // Get public projects
    const projects = await Project.find({ 
      owner: user._id,
      isPublic: true
    }).sort({ updatedAt: -1 });
    
    // Get user activities
    const activities = await Activity.find({ user: user._id })
      .populate('project')
      .populate('targetUser')
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Check if logged in user
    const currentUser = req.session.userId ? await User.findById(req.session.userId) : null;
    
    res.render('user', { 
      user, 
      projects,
      activities,
      currentUser
    });
  } catch (err) {
    console.error('User profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/profile/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    
    if (!user) {
      return res.status(404).render('error', { message: 'User not found' });
    }
    
    // Get public projects
    const projects = await Project.find({ 
      owner: user._id,
      isPublic: true
    }).sort({ updatedAt: -1 });
    
    // Check if logged in user
    const isOwnProfile = req.session.userId && req.session.userId.toString() === user._id.toString();
    const loggedInUser = req.session.userId ? await User.findById(req.session.userId) : null;
    
    res.render('public-profile', { 
      profileUser: user, 
      projects,
      isOwnProfile,
      loggedInUser
    });
  } catch (err) {
    console.error('Public profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Routes - Projects
app.get('/projects', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const projects = await Project.find({ owner: req.session.userId });
    res.render('projects', { user, projects });
  } catch (err) {
    console.error('Projects error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/projects/new', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    res.render('new-project', { user });
  } catch (err) {
    console.error('New project error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/projects', isAuthenticated, async (req, res) => {
  try {
    const { name, description, isPublic, genre } = req.body;
    
    // Create unique repository name
    const repoName = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${uuidv4().slice(0, 8)}`;
    const repoPath = path.join(os.tmpdir(), repoName);
    const remoteUrl = `${GIT_SERVER}/${repoName}.git`;

    // Create new project
    const newProject = new Project({
      name,
      description,
      isPublic: !!isPublic,
      owner: req.session.userId,
      collaborators: [],
      genre: genre || 'other',
      gitRepoUrl: remoteUrl,
      gitRepoPath: repoPath
    });
    
    await newProject.save();
    
    // Initialize Git repository
    await gitHelpers.initRepo(repoPath);
    await gitHelpers.addRemote(repoPath, remoteUrl);
    
    // Create initial commit
    const user = await User.findById(req.session.userId);
    await gitHelpers.commit(repoPath, 'Initial commit', user);
    await gitHelpers.push(repoPath);
    
    // Create activity record
    const activity = new Activity({
      user: req.session.userId,
      type: 'project_created',
      project: newProject._id
    });
    await activity.save();
    
    // Emit socket event for real-time updates
    io.emit('new-project', {
      project: {
        _id: newProject._id,
        name: newProject.name,
        description: newProject.description,
        owner: {
          _id: req.session.userId,
          username: user.username
        },
        updatedAt: newProject.updatedAt
      }
    });
    
    res.redirect(`/projects/${newProject._id}`);
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner')
      .populate('collaborators.user')
      .populate('versions');
    
    // Check if project is public or user is owner/collaborator
    if (!project.isPublic && 
        (!req.session.userId || 
         (req.session.userId.toString() !== project.owner._id.toString() && 
          !project.collaborators.some(c => c.user._id.toString() === req.session.userId.toString())))) {
      return res.status(403).render('error', { message: 'You do not have access to this project' });
    }
    
    const user = req.session.userId ? await User.findById(req.session.userId) : null;
    res.render('project', { project, user });
  } catch (err) {
    console.error('Project view error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://appleidmusic960:Dataking8@tapsidecluster.oeofi.mongodb.net/musichub', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
})
.then(() => console.log('MongoDB connected successfully'))
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Routes - Explore
app.get('/explore', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;
    
    // Build query based on search parameters
    let query = { isPublic: true };
    
    if (req.query.q) {
      query.name = { $regex: req.query.q, $options: 'i' };
    }
    
    if (req.query.genre && req.query.genre !== '') {
      query.genre = req.query.genre;
    }
    // Determine sort order
    let sortOption = { updatedAt: -1 }; // Default to newest
    
    if (req.query.sort === 'oldest') {
      sortOption = { createdAt: 1 };
    } else if (req.query.sort === 'popular') {
      // For a real app, you might sort by views, likes, etc.
      // Here we'll just use a placeholder
      sortOption = { updatedAt: -1 };
    }
    
    const projects = await Project.find(query)
      .populate('owner')
      .sort(sortOption)
      .skip(skip)
      .limit(limit);
    
    const totalProjects = await Project.countDocuments(query);
    const totalPages = Math.ceil(totalProjects / limit);
    
    const user = req.session.userId ? await User.findById(req.session.userId) : null;
    
    res.render('explore', { 
      projects, 
      user, 
      currentPage: page, 
      totalPages, 
      query: req.query.q,
      sort: req.query.sort || 'newest',
      genre: req.query.genre || ''
    });
  } catch (err) {
    console.error('Explore error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// API route for user search
app.get('/api/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const skip = (page - 1) * limit;
    
    let query = {};
    if (req.query.q) {
      query = { 
        $or: [
          { username: { $regex: req.query.q, $options: 'i' } },
          { name: { $regex: req.query.q, $options: 'i' } }
        ]
      };
    }
    
    const users = await User.find(query)
      .select('username avatar bio')
      .skip(skip)
      .limit(limit);
    
    // Get project count for each user
    const usersWithStats = await Promise.all(users.map(async (user) => {
      const projectCount = await Project.countDocuments({ owner: user._id });
      const followers = user.followers ? user.followers.length : 0;
      
      return {
        _id: user._id,
        username: user.username,
        avatar: user.avatar,
        bio: user.bio,
        projectCount,
        followers
      };
    }));
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / limit);
    
    res.json({
      users: usersWithStats,
      currentPage: page,
      totalPages,
      totalUsers
    });
  } catch (err) {
    console.error('User search API error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// API route for following/unfollowing users
app.post('/api/users/:id/follow', isAuthenticated, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = req.session.userId;
    
    // Don't allow following yourself
    if (targetUserId === currentUserId) {
      return res.status(400).json({ error: 'You cannot follow yourself' });
    }
    
    const currentUser = await User.findById(currentUserId);
    const targetUser = await User.findById(targetUserId);
    
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already following
    const isFollowing = currentUser.following && currentUser.following.some(id => id.toString() === targetUserId);
    
    if (isFollowing) {
      // Unfollow
      await User.findByIdAndUpdate(currentUserId, {
        $pull: { following: targetUserId }
      });
      
      await User.findByIdAndUpdate(targetUserId, {
        $pull: { followers: currentUserId }
      });
      
      return res.json({ following: false });
    } else {
      // Follow
      await User.findByIdAndUpdate(currentUserId, {
        $addToSet: { following: targetUserId }
      });
      
      await User.findByIdAndUpdate(targetUserId, {
        $addToSet: { followers: currentUserId }
      });
      
      // Create activity record
      const activity = new Activity({
        user: currentUserId,
        type: 'followed_user',
        targetUser: targetUserId
      });
      await activity.save();
      
      // Create notification for target user
      const notification = new Notification({
        recipient: targetUserId,
        sender: currentUserId,
        type: 'follow',
        message: `${currentUser.username} started following you`
      });
      await notification.save();
      
      return res.json({ following: true });
    }
  } catch (err) {
    console.error('Follow/unfollow error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
// Routes - Collaborations
app.get('/collaborations', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const collaborationProjects = await Project.find({ 
      'collaborators.user': req.session.userId 
    }).populate('owner');
    
    res.render('collaborations', { user, projects: collaborationProjects });
  } catch (err) {
    console.error('Collaborations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Routes - Authentication
app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register/initiate', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ 
        success: false,
        error: 'Username or email already in use' 
      });
    }

    // Generate verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store registration data and code in session
    req.session.pendingRegistration = {
      username,
      email,
      password,
      verificationCode,
      expiresAt: Date.now() + 600000 // 10 minutes
    };

    // Send verification code via email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Welcome to Rythmit - Verify Your Account',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background: #0d1117; color: #c9d1d9; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://rythmit.com/logo.png" alt="Rythmit Logo" style="width: 150px;">
          </div>
          <h1 style="color: #58a6ff; font-size: 24px; margin-bottom: 20px; text-align: center;">Welcome to Rythmit!</h1>
          <p style="font-size: 16px; line-height: 1.5; margin-bottom: 25px;">You're just one step away from joining the world's largest community of musicians. Please verify your email using the code below:</p>
          <div style="background: #161b22; padding: 20px; border-radius: 6px; text-align: center; margin: 30px 0;">
            <h2 style="color: #58a6ff; letter-spacing: 8px; font-size: 32px; margin: 0;">${verificationCode}</h2>
          </div>
          <p style="color: #8b949e; font-size: 14px; margin-bottom: 15px;">This verification code will expire in 10 minutes.</p>
          <p style="color: #8b949e; font-size: 14px;">If you didn't create a Rythmit account, please ignore this email or contact our support team if you have concerns.</p>
          <div style="border-top: 1px solid #30363d; margin-top: 30px; padding-top: 20px; text-align: center;">
            <p style="color: #8b949e; font-size: 12px;">© ${new Date().getFullYear()} Rythmit. All rights reserved.</p>
          </div>
        </div>
      `
    });

    res.json({ success: true });

  } catch (err) {
    console.error('Registration initiation error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Server error' 
    });
  }
});

app.post('/register/verify', async (req, res) => {
  try {
    const { code } = req.body;
    const registration = req.session.pendingRegistration;

    // Verify code exists and hasn't expired
    if (!registration || Date.now() > registration.expiresAt) {
      return res.json({
        success: false,
        error: 'Verification code expired. Please try again.'
      });
    }

    // Check code matches
    if (code !== registration.verificationCode) {
      return res.json({
        success: false,
        error: 'Invalid verification code'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(registration.password, salt);
    
    // Create new user
    const newUser = new User({
      username: registration.username,
      email: registration.email,
      password: hashedPassword,
      plan: 'free',
      emailVerified: true
    });
    
    await newUser.save();
    
    // Set session
    req.session.userId = newUser._id;
    req.session.user = {
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      plan: newUser.plan
    };

    // Send welcome email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: registration.email,
      subject: 'Welcome to the MusicHub Community!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background: #0d1117; color: #c9d1d9; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://musichub.cc/logo.png" alt="Rythmit Logo" style="width: 150px;">
          </div>
          
          <h1 style="color: #58a6ff; font-size: 28px; margin-bottom: 20px; text-align: center;">Welcome to Musichub, ${registration.username}!</h1>
          
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
            We're thrilled to have you join our growing community of musicians and creators. Your journey with MusicHub starts now!
          </p>

          <div style="background: #161b22; padding: 25px; border-radius: 8px; margin: 30px 0;">
            <h2 style="color: #58a6ff; font-size: 20px; margin-bottom: 15px;">Here's what you can do next:</h2>
            <ul style="list-style: none; padding: 0; margin: 0;">
              <li style="margin-bottom: 12px; padding-left: 24px; position: relative;">
                <span style="color: #58a6ff; position: absolute; left: 0;">→</span>
                Complete your profile and showcase your musical journey
              </li>
              <li style="margin-bottom: 12px; padding-left: 24px; position: relative;">
                <span style="color: #58a6ff; position: absolute; left: 0;">→</span>
                Connect with other musicians and collaborate on projects
              </li>
              <li style="margin-bottom: 12px; padding-left: 24px; position: relative;">
                <span style="color: #58a6ff; position: absolute; left: 0;">→</span>
                Share your music and get feedback from the community
              </li>
              <li style="padding-left: 24px; position: relative;">
                <span style="color: #58a6ff; position: absolute; left: 0;">→</span>
                Explore trending projects and join exciting collaborations
              </li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://musichub.cc" style="background: #238636; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Go to Dashboard</a>
          </div>

          <p style="color: #8b949e; font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
            Need help getting started? Check out our <a href="https://musichub.cc" style="color: #58a6ff; text-decoration: none;">beginner guides</a> or reach out to our support team at <a href="mailto:support@rythmit.com" style="color: #58a6ff; text-decoration: none;">support@rythmit.com</a>
          </p>

          <div style="border-top: 1px solid #30363d; margin-top: 30px; padding-top: 20px; text-align: center;">
            <div style="margin-bottom: 15px;">
              <a href="https://twitter.com/rythmit" style="color: #58a6ff; text-decoration: none; margin: 0 10px;">Twitter</a>
              <a href="https://instagram.com/rythmit" style="color: #58a6ff; text-decoration: none; margin: 0 10px;">Instagram</a>
              <a href="https://discord.gg/rythmit" style="color: #58a6ff; text-decoration: none; margin: 0 10px;">Discord</a>
            </div>
            <p style="color: #8b949e; font-size: 12px;">© ${new Date().getFullYear()} Rythmit. All rights reserved.</p>
          </div>
        </div>
      `
    });
    
    // Clear pending registration
    delete req.session.pendingRegistration;

    res.json({ success: true });

  } catch (err) {
    console.error('Registration verification error:', err);
    res.json({
      success: false,
      error: 'Server error'
    });
  }
});

app.post('/register/resend-code', async (req, res) => {
  try {
    const registration = req.session.pendingRegistration;

    if (!registration) {
      return res.json({
        success: false,
        error: 'No pending registration found'
      });
    }

    // Generate new code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Update session
    registration.verificationCode = verificationCode;
    registration.expiresAt = Date.now() + 600000; // 10 minutes

    // Send new code via email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail', 
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: registration.email,
      subject: 'Your new verification code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #58a6ff;">Your new verification code</h1>
          <p>Your verification code is:</p>
          <h2 style="letter-spacing: 5px;">${verificationCode}</h2>
          <p>This code will expire in 10 minutes.</p>
        </div>
      `
    });

    res.json({ success: true });

  } catch (err) {
    console.error('Code resend error:', err);
    res.json({
      success: false, 
      error: 'Server error'
    });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.redirect('/login?error=true');
    }
    
    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.redirect('/login?error=true');
    }
    
    // Set session
    req.session.userId = user._id;
    req.session.user = {
      _id: user._id,
      username: user.username,
      email: user.email,
      plan: user.plan
    };
    
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.redirect('/login?error=true');
  }
});

app.get('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.render('reset-password', { 
        token: req.params.token,
        error: 'Password reset token is invalid or has expired'
      });
    }

    res.render('reset-password', { 
      token: req.params.token,
      error: null
    });

  } catch (err) {
    console.error('Reset password error:', err);
    res.render('reset-password', {
      token: req.params.token, 
      error: 'An error occurred'
    });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.render('reset-password', {
        token: req.params.token,
        error: 'Password reset token is invalid or has expired'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    // Update user password and remove reset token
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.redirect('/login');

  } catch (err) {
    console.error('Reset password error:', err);
    res.render('reset-password', {
      token: req.params.token,
      error: 'An error occurred while resetting password'
    });
  }
});

app.get('/profile/contributions', isAuthenticated, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    // Get the start date (1 year ago from today)
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    
    // Find all project versions created by the user in the last year
    const projectVersions = await Version.find({
      creator: userId,
      createdAt: { $gte: startDate }
    }).select('createdAt');
    
    // Find all projects created by the user in the last year
    const projects = await Project.find({
      owner: userId,
      createdAt: { $gte: startDate }
    }).select('createdAt');
    
    // Find all comments made by the user in the last year
    const comments = await Comment.find({
      author: userId,
      createdAt: { $gte: startDate }
    }).select('createdAt');
    
    // Combine all activities
    const allActivities = [
      ...projectVersions.map(v => v.createdAt),
      ...projects.map(p => p.createdAt),
      ...comments.map(c => c.createdAt)
    ];
    
    // Create a map to count contributions by date
    const contributionMap = new Map();
    
    // Initialize the map with all dates in the past year (with zero counts)
    for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      contributionMap.set(dateStr, 0);
    }
    
    // Count contributions for each date
    allActivities.forEach(date => {
      const dateStr = date.toISOString().split('T')[0];
      if (contributionMap.has(dateStr)) {
        contributionMap.set(dateStr, contributionMap.get(dateStr) + 1);
      }
    });
    
    // Convert map to array of objects
    const contributions = Array.from(contributionMap, ([date, count]) => {
      // Determine level based on count
      let level = 0;
      if (count > 0) level = 1;
      if (count >= 3) level = 2;
      if (count >= 6) level = 3;
      if (count >= 9) level = 4;
      
      return { date, count, level };
    });
    
    res.json({ success: true, contributions });
  } catch (err) {
    console.error('Error fetching contribution data:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
app.get('/forgot-password', (req, res) => {
  res.render('forgot-password');
});

app.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.render('forgot-password', {
        error: 'No account found with that email address'
      });
    }

    // Generate reset token
    const token = crypto.randomBytes(20).toString('hex');
    
    // Set token and expiry on user account
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Send password reset email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background: #0d1117; color: #c9d1d9; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <img src="https://musichub.cc/logo.png" alt="MusicHub Logo" style="width: 150px;">
          </div>
          
          <h1 style="color: #58a6ff; font-size: 24px; margin-bottom: 20px;">Password Reset Request</h1>
          
          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
            You are receiving this email because you (or someone else) requested a password reset for your account.
          </p>

          <p style="font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
            Please click the button below to reset your password. This link will expire in 1 hour.
          </p>

          <div style="text-align: center; margin: 30px 0;">
            <a href="http://${req.headers.host}/reset-password/${token}" 
               style="background: #238636; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Reset Password
            </a>
          </div>

          <p style="color: #8b949e; font-size: 14px; line-height: 1.6;">
            If you did not request this reset, please ignore this email and your password will remain unchanged.
          </p>
        </div>
      `
    });

    res.render('forgot-password', {
      success: 'Password reset instructions have been sent to your email'
    });

  } catch (err) {
    console.error('Password reset error:', err);
    res.render('forgot-password', {
      error: 'An error occurred. Please try again later.'
    });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  try {
    const { password } = req.body;
    
    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.render('reset-password', {
        error: 'Password reset token is invalid or has expired'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Update user password and clear reset token
    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    // Send confirmation email
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Your password has been changed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px; background: #0d1117; color: #c9d1d9; border-radius: 8px;">
          <h1 style="color: #58a6ff;">Password Changed Successfully</h1>
          <p>This is a confirmation that the password for your account ${user.email} has just been changed.</p>
        </div>
      `
    });

    res.redirect('/login');

  } catch (err) {
    console.error('Password reset error:', err);
    res.render('reset-password', {
      error: 'An error occurred. Please try again later.'
    });
  }
});
// Version upload route
app.post('/projects/:projectId/versions/new', isAuthenticated, upload.array('files', 10), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message } = req.body;
    const files = req.files;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Check if user is owner or collaborator
    if (!project.owner.equals(req.session.userId) && 
        !project.collaborators.some(c => c.user.equals(req.session.userId))) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const version = await Version.create({
      project: projectId,
      creator: req.session.userId,
      message,
      files: files.map(file => ({
        filename: file.filename,
        originalName: file.originalname,
        fileType: file.mimetype,
        size: file.size
      }))
    });

    project.versions.push(version._id);
    await project.save();

    res.json({ success: true, version });

  } catch (err) {
    console.error('Version upload error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/profile/readme', isAuthenticated, async (req, res) => {
  try {
    const { readme } = req.body;
    
    // Configure marked for security
    marked.setOptions({
      sanitize: true,
      breaks: true
    });
    
    // Process markdown content
    const processedReadme = readme;
    
    // Find user and update readme
    const user = await User.findByIdAndUpdate(
      req.session.userId,
      { readme: processedReadme },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    // Convert markdown to HTML using marked
    
    // Configure marked for security
    marked.setOptions({
      sanitize: true,
      breaks: true
    });
    
    // Convert markdown to HTML
    const html = marked(readme);
    res.json({ 
      success: true, 
      html: html,
      message: 'README updated successfully' 
    });
  } catch (err) {
    console.error('README update error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Routes - Pages
app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  res.render('index');
});
app.get('/notifications', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    
    // Fetch user's notifications from the database
    const notifications = await Notification.find({ recipient: req.session.userId })
      .populate('sender', 'username profileImage')
      .populate('project', 'name')
      .sort({ createdAt: -1 })
      .limit(20);
    
    // Format notifications for display
    const formattedNotifications = notifications.map(notification => {
      return {
        id: notification._id,
        type: notification.type,
        sender: {
          id: notification.sender._id,
          username: notification.sender.username,
          avatar: notification.sender.profileImage || '/img/default-avatar.png'
        },
        project: notification.project ? {
          id: notification.project._id,
          name: notification.project.name
        } : null,
        message: notification.message,
        isRead: notification.isRead,
        createdAt: notification.createdAt
      };
    });
    
    // Mark notifications as seen (not necessarily read)
    if (formattedNotifications.length > 0) {
      await Notification.updateMany(
        { recipient: req.session.userId, seen: false },
        { $set: { seen: true } }
      );
    }
    
    // Get unread count for badge display
    const unreadCount = await Notification.countDocuments({ 
      recipient: req.session.userId, 
      isRead: false 
    });
    
    res.render('notifications', { 
      user, 
      notifications: formattedNotifications,
      unreadCount,
      title: 'Notifications',
      activeTab: 'notifications'
    });
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const projects = await Project.find({
      $or: [
        { owner: req.session.userId },
        { 'collaborators.user': req.session.userId }
      ]
    }).sort({ updatedAt: -1 });
    
    res.render('dashboard', { user, projects });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Projects
app.get('/projects/new', isAuthenticated, (req, res) => {
  res.render('new-project');
});

app.post('/projects', isAuthenticated, async (req, res) => {
  try {
    const { name, description, isPublic } = req.body;
    
    const newProject = new Project({
      name,
      description,
      owner: req.session.userId,
      isPublic: isPublic === 'on'
    });
    
    await newProject.save();
    
    // Create initial version (empty)
    const initialVersion = new Version({
      project: newProject._id,
      creator: req.session.userId,
      message: 'Project created',
      files: [],
      branch: 'main'
    });
    
    await initialVersion.save();
    
    res.redirect(`/projects/${newProject._id}`);
  } catch (err) {
    console.error('Project creation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/projects/:id', isAuthenticated, async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate('owner', 'username')
      .populate('collaborators.user', 'username')
      .lean();
    
    // Check if user has access
    if (!project.isPublic && 
        project.owner._id.toString() !== req.session.userId &&
        !project.collaborators.some(c => c.user._id.toString() === req.session.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const versions = await Version.find({ project: project._id })
      .populate('creator', 'username')
      .sort({ createdAt: -1 })
      .lean();
    
    const comments = await Comment.find({ project: project._id })
      .populate('user', 'username')
      .sort({ createdAt: -1 })
      .lean();
    
    // Get user
    const user = await User.findById(req.session.userId).lean();
    
    // Add versions to project object instead of populating
    project.versions = versions;
    
    res.render('project', { project, comments, user });
  } catch (err) {
    console.error('Project view error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/projects/:id/collaborate', isAuthenticated, async (req, res) => {
  try {
    const { email, role } = req.body;
    
    // Find project
    const project = await Project.findById(req.params.id);
    
    // Check if user is owner
    if (project.owner.toString() !== req.session.userId) {
      return res.status(403).json({ error: 'Only project owner can add collaborators' });
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if already a collaborator
    if (project.collaborators.some(c => c.user.toString() === user._id.toString())) {
      return res.status(400).json({ error: 'User is already a collaborator' });
    }
    
    // Add collaborator
    project.collaborators.push({
      user: user._id,
      role
    });
    
    await project.save();
    
    res.redirect(`/projects/${project._id}`);
  } catch (err) {
    console.error('Add collaborator error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Versions
app.post('/projects/:id/versions', isAuthenticated, upload.array('files', 10), checkStorageLimit, async (req, res) => {
  try {
    const { message, branch } = req.body;
    const files = req.files || [];
    
    // Find project
    const project = await Project.findById(req.params.id);
    
    // Check if user has access
    if (project.owner.toString() !== req.session.userId &&
        !project.collaborators.some(c => c.user.toString() === req.session.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get latest version on branch
    const latestVersion = await Version.findOne({ 
      project: project._id,
      branch
    }).sort({ createdAt: -1 });
    
    // Create new version
    const newVersion = new Version({
      project: project._id,
      creator: req.session.userId,
      message,
      files: files.map(file => ({
        originalName: file.originalname,
        s3Key: file.key,
        fileType: file.mimetype,
        size: file.size
      })),
      branch,
      parentVersion: latestVersion ? latestVersion._id : null
    });
    
    await newVersion.save();
    
    // Update project
    project.updatedAt = Date.now();
    await project.save();
    
    // Update user storage used
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    await User.findByIdAndUpdate(req.session.userId, {
      $inc: { storageUsed: totalSize }
    });
    
    res.redirect(`/projects/${project._id}`);
  } catch (err) {
    console.error('Version creation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/projects/:projectId/versions/:versionId', isAuthenticated, async (req, res) => {
  try {
    const version = await Version.findById(req.params.versionId)
      .populate('creator', 'username')
      .populate('project');
    
    // Check if user has access
    const project = await Project.findById(version.project);
    if (!project.isPublic && 
        project.owner.toString() !== req.session.userId &&
        !project.collaborators.some(c => c.user.toString() === req.session.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    const comments = await Comment.find({ version: version._id })
      .populate('user', 'username')
      .sort({ createdAt: 1 });
    
    // Get presigned URLs for files
    for (let file of version.files) {
      file.url = s3.getSignedUrl('getObject', {
        Bucket: process.env.S3_BUCKET_NAME || 'rythmit-files',
        Key: file.s3Key,
        Expires: 3600 // URL expires in 1 hour
      });
    }
    
    res.render('version', { version, comments });
  } catch (err) {
    console.error('Version view error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Comments
app.post('/projects/:projectId/versions/:versionId/comments', isAuthenticated, async (req, res) => {
  try {
    const { text, timestamp } = req.body;
    
    const newComment = new Comment({
      project: req.params.projectId,
      version: req.params.versionId,
      user: req.session.userId,
      text,
      timestamp: timestamp ? parseFloat(timestamp) : null
    });
    
    await newComment.save();
    
    // Emit socket event for real-time updates
    io.to(`project-${req.params.projectId}`).emit('new-comment', {
      comment: newComment,
      username: (await User.findById(req.session.userId)).username
    });
    
    res.redirect(`/projects/${req.params.projectId}/versions/${req.params.versionId}`);
  } catch (err) {
    console.error('Comment creation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// API Routes for AJAX
app.post('/api/projects/:id/fork', isAuthenticated, async (req, res) => {
  try {
    const sourceProject = await Project.findById(req.params.id);
    
    // Check if project is public or user has access
    if (!sourceProject.isPublic && 
        sourceProject.owner.toString() !== req.session.userId &&
        !sourceProject.collaborators.some(c => c.user.toString() === req.session.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Create forked project
    const forkedProject = new Project({
      name: `${sourceProject.name} (Fork)`,
      description: `Forked from ${sourceProject.name}`,
      owner: req.session.userId,
      isPublic: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    
    await forkedProject.save();
    
    // Get latest version from source project
    const latestVersion = await Version.findOne({ project: sourceProject._id })
      .sort({ createdAt: -1 });
    
    if (latestVersion) {
      // Copy files to new S3 location
      const newFiles = [];
      
      for (const file of latestVersion.files) {
        const sourceKey = file.s3Key;
        const targetKey = `${req.session.userId}/fork-${Date.now()}-${path.basename(sourceKey)}`;
        
        // Copy file in S3
        await s3.copyObject({
          Bucket: process.env.S3_BUCKET_NAME || 'rythmit-files',
          CopySource: `${process.env.S3_BUCKET_NAME || 'rythmit-files'}/${sourceKey}`,
          Key: targetKey,
          ACL: 'private'
        }).promise();
        
        newFiles.push({
          originalName: file.originalName,
          s3Key: targetKey,
          fileType: file.fileType,
          size: file.size
        });
      }
      
      // Create initial version for forked project
      const forkedVersion = new Version({
        project: forkedProject._id,
        creator: req.session.userId,
        message: `Forked from ${sourceProject.name}`,
        files: newFiles,
        branch: 'main'
      });
      
      await forkedVersion.save();
      
      // Update user storage used
      const totalSize = newFiles.reduce((sum, file) => sum + file.size, 0);
      await User.findByIdAndUpdate(req.session.userId, {
        $inc: { storageUsed: totalSize }
      });
    }
    
    res.status(200).json({ 
      success: true, 
      projectId: forkedProject._id 
    });
  } catch (err) {
    console.error('Fork error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/files/preview', isAuthenticated, async (req, res) => {
  try {
    const { s3Key } = req.body;
    
    // Get file from S3
    const params = {
      Bucket: process.env.S3_BUCKET_NAME || 'rythmit-files',
      Key: s3Key
    };
    
    // Create temporary local file
    const tempFilePath = path.join(os.tmpdir(), path.basename(s3Key));
    
    // Download file from S3
    const s3Stream = s3.getObject(params).createReadStream();
    const fileStream = fs.createWriteStream(tempFilePath);
    
    s3Stream.pipe(fileStream);
    
    fileStream.on('finish', () => {
      // Generate audio preview using FFmpeg (30 second preview)
      const outputPath = tempFilePath + '-preview.mp3';
      
      exec(`ffmpeg -i "${tempFilePath}" -t 30 -q:a 0 -map a "${outputPath}"`, async (error) => {
        if (error) {
          console.error('FFmpeg error:', error);
          return res.status(500).json({ error: 'Preview generation failed' });
        }
        
        // Upload preview to S3
        const previewKey = `previews/${req.session.userId}/${Date.now()}-preview.mp3`;
        
        const fileContent = fs.readFileSync(outputPath);
        
        await s3.putObject({
          Bucket: process.env.S3_BUCKET_NAME || 'rythmit-files',
          Key: previewKey,
          Body: fileContent,
          ContentType: 'audio/mpeg',
          ACL: 'private'
        }).promise();
        
        // Clean up temporary files
        fs.unlinkSync(tempFilePath);
        fs.unlinkSync(outputPath);
        
        // Generate signed URL for preview
        const previewUrl = s3.getSignedUrl('getObject', {
          Bucket: process.env.S3_BUCKET_NAME || 'rythmit-files',
          Key: previewKey,
          Expires: 3600 // URL expires in 1 hour
        });
        
        res.status(200).json({ previewUrl });
      });
    });
  } catch (err) {
    console.error('Preview generation error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Socket.IO for real-time collaboration
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Join a project room
  socket.on('join-project', (projectId) => {
    socket.join(`project-${projectId}`);
    console.log(`Socket ${socket.id} joined project ${projectId}`);
  });
  
  // Handle real-time DAW sync messages
  socket.on('daw-update', (data) => {
    // Forward the update to all other clients in the project room
    socket.to(`project-${data.projectId}`).emit('daw-update', data);
  });
  
  // Handle user typing in chat
  socket.on('typing', (data) => {
    socket.to(`project-${data.projectId}`).emit('user-typing', {
      username: data.username
    });
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Rythmit server running on port ${PORT}`);
});