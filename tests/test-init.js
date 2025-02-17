import { TestSuiteRunner } from './RunAllTests.js';
import { ccLogger } from '../src/global.js';

// Override ccLogger to also write to results div
const resultsDiv = document.getElementById('results');
const analysisDiv = document.getElementById('analysis');

// Keep track of timers and test statistics
const timers = new Map();
let currentStats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0
};

function appendToResults(level, ...args) {
    const text = args.join(' ');
    const div = document.createElement('div');
    div.className = `test-group ${level}`;
    div.textContent = text;
    resultsDiv.appendChild(div);
    resultsDiv.scrollTop = resultsDiv.scrollHeight;
    console[level](...args);
}

// Override logger methods
ccLogger.log = (...args) => appendToResults('info', ...args);
ccLogger.info = (...args) => appendToResults('info', ...args);
ccLogger.warn = (...args) => appendToResults('warning', ...args);
ccLogger.error = (...args) => appendToResults('error', ...args);
ccLogger.debug = (...args) => appendToResults('info', ...args);
ccLogger.group = (name) => appendToResults('info', `=== ${name} ===`);
ccLogger.groupEnd = () => appendToResults('info', '');
ccLogger.time = (label) => {
    timers.set(label, performance.now());
    console.time(label);
    appendToResults('time', `Started timer: ${label}`);
};
ccLogger.timeEnd = (label) => {
    const startTime = timers.get(label);
    if (startTime) {
        const duration = performance.now() - startTime;
        timers.delete(label);
        console.timeEnd(label);
        appendToResults('time', `${label}: ${duration.toFixed(2)}ms`);
    }
};

function updateAnalysis() {
    document.getElementById('totalTests').textContent = currentStats.total;
    document.getElementById('passedTests').textContent = currentStats.passed;
    document.getElementById('failedTests').textContent = currentStats.failed;
    document.getElementById('skippedTests').textContent = currentStats.skipped;

    const progressPercent = currentStats.total > 0 
        ? (currentStats.passed / currentStats.total) * 100 
        : 0;
    document.querySelector('.progress-fill').style.width = `${progressPercent}%`;
}

// Set up button handlers
document.getElementById('runAll').addEventListener('click', async () => {
    const button = document.getElementById('runAll');
    button.disabled = true;
    resultsDiv.textContent = 'Running all tests...\n\n';
    currentStats = { total: 0, passed: 0, failed: 0, skipped: 0 };
    
    try {
        const results = await TestSuiteRunner.runAllTests();
        currentStats = results;
        updateAnalysis();
    } catch (error) {
        appendToResults('error', 'Error running tests:', error);
    }
    
    button.disabled = false;
});

document.getElementById('clearResults').addEventListener('click', () => {
    resultsDiv.textContent = 'Click "Run All Tests" or select a specific test category to begin...';
    currentStats = { total: 0, passed: 0, failed: 0, skipped: 0 };
    updateAnalysis();
    timers.clear();
});

// Add handlers for category buttons
document.querySelectorAll('.category-button').forEach(button => {
    button.addEventListener('click', async () => {
        const suite = button.dataset.suite;
        button.disabled = true;
        resultsDiv.textContent = `Running ${suite} tests...\n\n`;
        currentStats = { total: 0, passed: 0, failed: 0, skipped: 0 };
        
        try {
            const results = await TestSuiteRunner.runSuite(suite);
            currentStats = results;
            updateAnalysis();
        } catch (error) {
            appendToResults('error', `Error running ${suite} tests:`, error);
        }
        
        button.disabled = false;
    });
}); 