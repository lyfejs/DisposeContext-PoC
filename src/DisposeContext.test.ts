import { DisposeContext, SetAsyncContextConstructor } from "./DisposeContext";
import { NodeAsyncContext } from './node';
import { exit } from 'node:process';

SetAsyncContextConstructor(NodeAsyncContext);

function log(...args: any[]): void {
    const time = Math.floor(performance.now());
    console.log(time, ...args);
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function Allocate(length: number): Array<any> {
    const arr = new Array(length).fill(length);
    DisposeContext.defer(() => log('deallocate end'));
    DisposeContext.deferAsync(async () => sleep(500));
    DisposeContext.defer(() => arr.splice(0, length));
    DisposeContext.defer(() => log('deallocate start'));
    return arr;
}

async function main() {
    log('main start');
    await DisposeContext.runAsync(async () => {
        log('AsyncDisposeContext scope start');
        const arr = Allocate(5);
        log('arr =', arr); // [5, 5, 5, 5, 5];
    
        setTimeout(() => {
            log('AsyncDisposeContext setTimeout start');
            log('arr =', arr); // [5, 5, 5, 5, 5];
            log('AsyncDisposeContext setTimeout end');
        }, 1000);

        log('AsyncDisposeContext scope end');
    });
    log('main end');
    exit(0);
}

if (typeof global.gc === 'function') {
    // force using a more frequent gc cycle (--expose-gc flag required)
    setInterval(() => {
        log('gc');
        gc!();
    }, 2000);
} else {
    // this sleep is required to keep the macrotask queue non-empty
    // otherwise when we wait for gc our microtask queue would be empty, and
    // the process would be terminated, before gc can kick-in
    sleep(60 * 1000);
}

main();

/**
 * Example Output:
 * 704 main start
 * 705 AsyncDisposeContext scope start
 * 706 arr = [ 5, 5, 5, 5, 5 ]
 * 707 AsyncDisposeContext scope end
 * 1709 AsyncDisposeContext setTimeout start
 * 1710 arr = [ 5, 5, 5, 5, 5 ]
 * 1711 AsyncDisposeContext setTimeout end
 * 2717 gc
 * 2730 deallocate start
 * 3243 deallocate end
 * 3245 main end
 */
