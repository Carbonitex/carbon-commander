const fs = require('fs-extra');
const archiver = require('archiver');
const path = require('path');
const { exec } = require('child_process');

async function packageExtension() {
    const buildDir = path.join(__dirname, 'dist');
    const srcDir = path.join(__dirname, 'src');
    const outputFile = path.join(__dirname, 'carboncommander-extension.zip');
    
    try {
        //Remove the dist directory if it exists
        if (fs.existsSync(buildDir)) {
            await fs.remove(buildDir);
        }

        //Run webpack
        await exec('webpack'); 
        
        // Ensure build directory exists
        await fs.ensureDir(buildDir);
        
        // Copy extension files to build directory
        await fs.copy('manifest.json', path.join(buildDir, 'manifest.json'));

        // Copy the entire src directory to build directory
        await fs.copy(srcDir, buildDir);


        // remove carbon-commander.js from the build directory as it is built by webpack
        await fs.remove(path.join(buildDir, 'carbon-commander.js'));


        // Create a write stream for our zip file
        const output = fs.createWriteStream(outputFile);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });
        
        // Listen for all archive data to be written
        output.on('close', () => {
            console.log(`Extension packaged successfully! (${archive.pointer()} bytes)`);
            console.log(`Output: ${outputFile}`);
        });
        
        // Good practice to catch warnings
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Warning:', err);
            } else {
                throw err;
            }
        });
        
        // Catch errors
        archive.on('error', (err) => {
            throw err;
        });
        
        // Pipe archive data to the output file
        archive.pipe(output);
        
        // Add the build directory contents to the zip
        archive.directory(buildDir, false);
        
        // Finalize the archive
        await archive.finalize();
        
    } catch (error) {
        console.error('Error packaging extension:', error);
        process.exit(1);
    }
}

packageExtension();