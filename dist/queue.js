import { indexFile } from "./indexer.js";
export class IndexQueue {
    pending = new Map();
    running = false;
    ready = [];
    db;
    log;
    errorCount = 0;
    lastIndexTime = null;
    totalChunks = 0;
    constructor({ db, log }) {
        this.db = db;
        this.log = log;
    }
    enqueue(path) {
        const existing = this.pending.get(path);
        if (existing) {
            clearTimeout(existing.timer);
        }
        const timer = setTimeout(() => {
            this.pending.delete(path);
            this.ready.push(path);
            this.drain();
        }, 1500);
        this.pending.set(path, { path, timer });
    }
    get depth() {
        return this.pending.size + this.ready.length;
    }
    get stats() {
        return {
            errorCount: this.errorCount,
            lastIndexTime: this.lastIndexTime,
            totalChunks: this.totalChunks,
        };
    }
    async indexNow(path) {
        const existing = this.pending.get(path);
        if (existing) {
            clearTimeout(existing.timer);
            this.pending.delete(path);
        }
        return this.runIndex(path);
    }
    async runIndex(path) {
        try {
            const result = await indexFile({ db: this.db, path });
            this.lastIndexTime = Date.now();
            this.totalChunks += result.chunksAdded;
            if (result.chunksAdded > 0) {
                this.log(`indexed ${path}: +${result.chunksAdded} chunks`);
            }
            return result;
        }
        catch (err) {
            this.errorCount++;
            this.log(`error indexing ${path}: ${String(err)}`);
            return { chunksAdded: 0, bytesRead: 0 };
        }
    }
    async drain() {
        if (this.running)
            return;
        this.running = true;
        while (this.ready.length > 0) {
            const path = this.ready.shift();
            await this.runIndex(path);
        }
        this.running = false;
    }
}
//# sourceMappingURL=queue.js.map