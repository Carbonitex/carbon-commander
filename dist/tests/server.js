const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
};

const server = http.createServer((req, res) => {
    // Remove query string and decode URI
    let filePath = decodeURIComponent(req.url.split('?')[0]);
    
    // Default to test.html for root path
    if (filePath === '/') {
        filePath = '/tests/test.html';
    }

    // Convert URL path to filesystem path
    filePath = path.join(process.cwd(), 'src', filePath);

    // Security check: ensure path is within src directory
    const srcDir = path.join(process.cwd(), 'src');
    if (!filePath.startsWith(srcDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // Get file extension and corresponding MIME type
    const extname = path.extname(filePath);
    const contentType = MIME_TYPES[extname] || 'text/plain';

    // Read and serve the file
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                console.error(`File not found: ${filePath}`);
                res.writeHead(404);
                res.end(`File not found: ${req.url}`);
            } else {
                console.error(`Server error: ${error.code} - ${filePath}`);
                res.writeHead(500);
                res.end(`Server error: ${error.code}`);
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Test server running at http://localhost:${PORT}/`);
    console.log(`Serving files from: ${path.join(process.cwd(), 'src')}`);
}); 