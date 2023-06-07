/// <reference lib="es2021.weakref" />
import './types/AsyncContext';

const DisposeContextSymbol = Symbol();

let _AsyncContext!: AsyncContextConstructor;
let gContext!: AsyncContext<DisposeContextRef | undefined>;

export function SetAsyncContextConstructor(func: AsyncContextConstructor): void {
    _AsyncContext = func;
    gContext = new _AsyncContext<DisposeContextRef | undefined>({
        name: "DisposeContext",
        defaultValue: undefined,
    });
}

export interface DisposeContextRef {
    [DisposeContextSymbol]: DisposeContext;
}

export abstract class DisposeContext {
    #parent = gContext.get();

    // static #weakMap = new WeakMap<DisposeContext, DisposeContextRef>();
    static #finalizer = new FinalizationRegistry(DisposeContext.finalizeRef);

    private static finalizeRef(context: DisposeContext): void {
        context.release();
    }

    public static run<R>(func: () => R): R;
    public static run<R>(context: DisposeContextRef, func: () => R): R;
    public static run<R>(
        refORfunc: DisposeContextRef | (() => R),
        funcOrVoid?: () => R
    ): R {
        let context!: SyncDisposeContext;
        let ref!: DisposeContextRef;
        let func!: () => R;
        if (typeof refORfunc === "function" && funcOrVoid == null) {
            context = new SyncDisposeContext();
            func = refORfunc as typeof func;
        } else if (refORfunc != null && typeof funcOrVoid === "function") {
            ref = refORfunc as DisposeContextRef;
            context = ref[DisposeContextSymbol] as SyncDisposeContext;
            if (context == null) {
                throw ReferenceError("context not found");
            }
            if (!(context instanceof SyncDisposeContext)) {
                throw TypeError("context is not an SyncDisposeContext");
            }
            func = funcOrVoid;
        } else {
            throw TypeError(`invalid parameters to DisposeContext.run()`);
        }
        context.open();
        try {
            return gContext.run(ref, func);
        } finally {
            ref = null!;
            context.close();
        }
    }

    public static runAsync<R>(func: () => Promise<R>): Promise<R>;
    public static runAsync<R>(
        context: DisposeContextRef,
        func: () => Promise<R>
    ): Promise<R>;
    public static async runAsync<R>(
        refORfunc: DisposeContextRef | (() => Promise<R>),
        funcOrVoid?: () => Promise<R>
    ): Promise<R> {
        let shouldWait = false;
        let context!: AsyncDisposeContext;
        let ref!: DisposeContextRef;
        let func!: () => Promise<R>;
        if (typeof refORfunc === "function" && funcOrVoid == null) {
            shouldWait = true;
            context = new AsyncDisposeContext();
            func = refORfunc as typeof func;
            ref = context.retain();
        } else if (refORfunc != null && typeof funcOrVoid === "function") {
            ref = refORfunc as DisposeContextRef;
            context = ref[DisposeContextSymbol] as AsyncDisposeContext;
            if (context == null) {
                throw ReferenceError("context not found");
            }
            if (!(context instanceof AsyncDisposeContext)) {
                throw TypeError("context is not an AsyncDisposeContext");
            }
            func = funcOrVoid;
        } else {
            throw TypeError(`invalid parameters to DisposeContext.runAsync()`);
        }
        context.open();
        try {
            return await gContext.run(ref, func);
        } finally {
            ref = null!;
            context.close();
            if (shouldWait) {
                await context.waitAsync();
            }
        }
    }

    public abstract defer(func: () => void): void;
    public static defer(func: () => void): void {
        const context = gContext.get()?.[DisposeContextSymbol];
        if (context == null) {
            throw ReferenceError("context not found");
        }
        gContext.run(context.#parent, () => {
            context.defer(_AsyncContext.wrap(func));
        });
    }

    public abstract deferAsync(func: () => Promise<void>): void;
    public static deferAsync(func: () => Promise<void>): void {
        const context = gContext.get()?.[DisposeContextSymbol];
        if (context == null) {
            throw ReferenceError("context not found");
        }
        gContext.run(context.#parent, () => {
            context.deferAsync(_AsyncContext.wrap(func));
        });
    }

    public static retain(): DisposeContextRef {
        const context = gContext.get()?.[DisposeContextSymbol];
        if (context == null) {
            throw ReferenceError("context not found");
        }
        return context.retain();
    }

    #retainCount = 0;
    public retain(): DisposeContextRef {
        // hold the context as long as the ref exists
        const ref = { [DisposeContextSymbol]: this } as DisposeContextRef;
        // When there's no more references to the ref, we can release the ref
        DisposeContext.#finalizer.register(ref, this);
        this.#retainCount++;
        return ref;
    }

    public release(): void {
        if (!this.#retainCount) {
            throw new ReferenceError('releasing a DisposeContext that is not being retained');
        }
        this.#retainCount--;
        this.#checkAndDispose();
    }

    #openCount = 0;
    #disposed = false;
    public get disposed(): boolean {
        return this.#disposed;
    }

    public open(): void {
        if (this.#disposed) {
            throw new ReferenceError('DisposeContext already disposed');
        }
        this.#openCount++;
    }

    public close(): void {
        if (this.#disposed) {
            throw new ReferenceError('DisposeContext already disposed');
        }
        this.#openCount--;
        this.#checkAndDispose();
    }

    #checkAndDispose(): void {
        // we are allowed to dispose if:
        if (this.#retainCount === 0 // 1. no one is holding a DisposeContextRef to it
            && this.#openCount === 0 // 2. all opened contexts are closed
        ) {
            this.#disposed = true;
            this.dispose();
        }
    }

    public abstract dispose(): void;
}

class SyncDisposeContext extends DisposeContext {
    #deferred = [] as Array<() => void>;
    public defer(func: () => void): void {
        if (this.disposed) {
            throw new ReferenceError('DisposeContext already disposed');
        }
        this.#deferred.push(func);
    }

    public deferAsync(func: () => Promise<void>): void {
        throw TypeError("cannot deferAsync on SyncDisposeContext");
    }

    public dispose(): void {
        let error: any;
        let hasError = false;
        while (this.#deferred.length) {
            const func = this.#deferred.pop()!;
            try {
                func();
            } catch(e) {
                if (hasError) {
                    // TODO: SuppressError
                }
                error = e;
                hasError = true;
            }
        }
        if (hasError) {
            throw error;
        }
    }
}

class AsyncDisposeContext extends DisposeContext {
    #promise!: Promise<void>;
    #resolve!: () => void;
    #reject!: (err: any) => void;
    #deferred = [] as Array<() => Promise<void>|void>;
    constructor() {
        super();
        this.#promise = new Promise((resolve, reject) => {
            this.#resolve = resolve;
            this.#reject = reject;
        });
    }

    public defer(func: () => void): void {
        if (this.disposed) {
            throw new ReferenceError('DisposeContext already disposed');
        }
        this.#deferred.push(func);
    }

    public deferAsync(func: () => Promise<void>): void {
        if (this.disposed) {
            throw new ReferenceError('DisposeContext already disposed');
        }
        this.#deferred.push(func);
    }

    public async dispose(): Promise<void> {
        let error: any;
        let hasError = false;
        while (this.#deferred.length) {
            const func = this.#deferred.pop()!;
            try {
                await func();
            } catch(e) {
                if (hasError) {
                    // TODO: SuppressError
                }
                error = e;
                hasError = true;
            }
        }
        if (hasError) {
            this.#reject(error);
            throw error;
        }
        this.#resolve();
    }

    public async waitAsync(): Promise<void> {
        return this.#promise;
    }
}
