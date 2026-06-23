const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { parseHtmlDocument } = require('./html-parser');

const DEFAULT_POOL_SIZE = Math.min(8, Math.max(1, (os.cpus().length || 1) - 1));
const WORKER_PATH = path.join(__dirname, 'html-parse-worker.js');

let activePool = null;
let nextTaskId = 0;

function createHtmlParsePool(poolSize = DEFAULT_POOL_SIZE) {
    const workers = [];
    const taskQueue = [];
    const pendingTasks = new Map();

    function dispatchNext() {
        while (taskQueue.length > 0) {
            const worker = workers.find((entry) => !entry.busy);
            if (!worker) {
                return;
            }

            const task = taskQueue.shift();
            worker.busy = true;
            worker.currentTaskId = task.id;
            worker.instance.postMessage({
                id: task.id,
                html: task.html,
                currentUrl: task.currentUrl,
                allowedHostname: task.allowedHostname,
            });
        }
    }

    function finishTask(worker, message) {
        worker.busy = false;
        worker.currentTaskId = null;

        const task = pendingTasks.get(message.id);
        if (!task) {
            dispatchNext();
            return;
        }

        pendingTasks.delete(message.id);
        if (message.ok) {
            task.resolve(message.result);
        } else {
            task.reject(new Error(message.error || 'HTML parse worker failed'));
        }
        dispatchNext();
    }

    function rejectTask(worker, error) {
        const taskId = worker.currentTaskId;
        worker.busy = false;
        worker.currentTaskId = null;

        if (taskId != null) {
            const task = pendingTasks.get(taskId);
            if (task) {
                pendingTasks.delete(taskId);
                task.reject(error);
            }
        }
        dispatchNext();
    }

    function spawnWorker() {
        const worker = {
            instance: new Worker(WORKER_PATH),
            busy: false,
            currentTaskId: null,
        };

        worker.instance.on('message', (message) => {
            finishTask(worker, message);
        });
        worker.instance.on('error', (error) => {
            rejectTask(worker, error);
        });
        worker.instance.on('exit', (code) => {
            if (code !== 0) {
                rejectTask(worker, new Error(`HTML parse worker exited with code ${code}`));
            }
        });

        workers.push(worker);
        return worker;
    }

    for (let index = 0; index < poolSize; index += 1) {
        spawnWorker();
    }

    return {
        parse(html, currentUrl, allowedHostname) {
            return new Promise((resolve, reject) => {
                const id = nextTaskId + 1;
                nextTaskId = id;
                pendingTasks.set(id, { resolve, reject });
                taskQueue.push({
                    id,
                    html,
                    currentUrl,
                    allowedHostname,
                });
                dispatchNext();
            });
        },
        async terminate() {
            taskQueue.length = 0;
            for (const [, task] of pendingTasks) {
                task.reject(new Error('HTML parse pool terminated'));
            }
            pendingTasks.clear();
            await Promise.all(workers.map((worker) => worker.instance.terminate()));
            workers.length = 0;
        },
    };
}

function getHtmlParsePool() {
    if (!activePool) {
        activePool = createHtmlParsePool();
    }
    return activePool;
}

async function terminateHtmlParsePool() {
    if (!activePool) {
        return;
    }
    const pool = activePool;
    activePool = null;
    await pool.terminate();
}

function parseHtmlDocumentAsync(html, currentUrl, allowedHostname) {
    if (process.env.SPIDER_HTML_PARSE_IN_PROCESS === '1') {
        return Promise.resolve(parseHtmlDocument(html, currentUrl, allowedHostname));
    }
    return getHtmlParsePool().parse(html, currentUrl, allowedHostname);
}

module.exports = {
    DEFAULT_POOL_SIZE,
    WORKER_PATH,
    createHtmlParsePool,
    getHtmlParsePool,
    terminateHtmlParsePool,
    parseHtmlDocumentAsync,
    parseHtmlDocument,
};
