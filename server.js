const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve all static files from root directory
app.use(express.static(__dirname));

// Route all requests to Invisible-Cafeteria.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'Invisible-Cafeteria.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
