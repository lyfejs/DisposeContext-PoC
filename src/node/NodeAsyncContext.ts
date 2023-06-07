import '../types/AsyncContext';
import { AsyncLocalStorage } from 'node:async_hooks';

export class NodeAsyncContext<T> {
    #storage = new AsyncLocalStorage<T>();
    #name!: string;

    constructor(options: AsyncContextOptions<T>) {
        this.#name = options.name || 'NodeAsyncContext';
        this.#storage.enterWith(options.defaultValue!);
    }

    static wrap<R, Args extends any[]>(
        callback: (...args: Args) => R
    ): (...args: Args) => R {
        return AsyncLocalStorage.bind(callback);
    }

    get name(): string {
        return this.#name;
    }

    run<R>(value: T, callback: () => R): R {
        return this.#storage.run(value, callback);
    }

    get() {
        return this.#storage.getStore();
    };
}

