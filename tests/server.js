const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.mjs': 'text/javascript'  // Add support for ES modules
};

const server = http.createServer((req, res) => {
    try {
        // Remove query string and decode URI
        let filePath = decodeURIComponent(req.url.split('?')[0]);
        
        // Default to test.html for root path
        if (filePath === '/') {
            filePath = '/tests/test.html';
        }

        // Normalize the path to resolve any '..' or '.' segments
        filePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
        
        // Ensure the path starts with a forward slash
        if (!filePath.startsWith('/')) {
            filePath = '/' + filePath;
        }

        // Convert URL path to filesystem path
        let fullPath;
        if (filePath.startsWith('/tests/')) {
            fullPath = path.join(process.cwd(), filePath);
        } else if (filePath.startsWith('/src/')) {
            fullPath = path.join(process.cwd(), filePath);
        } else if (filePath.startsWith('/node_modules/')) {
            fullPath = path.join(process.cwd(), filePath);
        } else {
            // For any other files, try src directory first, then tests
            const srcPath = path.join(process.cwd(), 'src', filePath);
            const testsPath = path.join(process.cwd(), 'tests', filePath);
            const nodePath = path.join(process.cwd(), 'node_modules', filePath);
            
            if (fs.existsSync(srcPath)) {
                fullPath = srcPath;
            } else if (fs.existsSync(testsPath)) {
                fullPath = testsPath;
            } else if (fs.existsSync(nodePath)) {
                fullPath = nodePath;
            } else {
                fullPath = path.join(process.cwd(), filePath);
            }
        }

        // Normalize the full path to resolve any remaining '..' or '.' segments
        fullPath = path.normalize(fullPath);

        // Security check: ensure path is within project directory
        const projectDir = path.normalize(process.cwd());
        if (!fullPath.startsWith(projectDir)) {
            console.error(`Security violation: Attempted path traversal to ${fullPath}`);
            res.writeHead(403);
            res.end('Forbidden: Invalid path');
            return;
        }

        // Additional security check: verify the path exists and is a file
        if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        // Get file extension and corresponding MIME type
        const extname = path.extname(fullPath);
        const contentType = MIME_TYPES[extname] || 'text/plain';

        // Add CORS headers for development
        const headers = {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        };

        // Handle OPTIONS requests for CORS
        if (req.method === 'OPTIONS') {
            res.writeHead(204, headers);
            res.end();
            return;
        }

        // Read and serve the file
        fs.readFile(fullPath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    console.error(`File not found: ${fullPath}`);
                    res.writeHead(404);
                    res.end(`File not found: ${req.url}`);
                } else {
                    console.error(`Server error: ${error.code} - ${fullPath}`);
                    res.writeHead(500);
                    res.end(`Server error: ${error.code}`);
                }
            } else {
                res.writeHead(200, headers);
                res.end(content, 'utf-8');
            }
        });
    } catch (error) {
        console.error(`Server error: ${error.message}`);
        res.writeHead(500);
        res.end('Internal Server Error');
    }
});

server.listen(PORT, () => {
    console.log(`Test server running at http://localhost:${PORT}/`);
    console.log(`Serving files from:`);
    console.log(`- ${path.join(process.cwd(), 'src')}`);
    console.log(`- ${path.join(process.cwd(), 'tests')}`);
    console.log(`- ${path.join(process.cwd(), 'node_modules')}`);
}); 