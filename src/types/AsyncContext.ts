export {};

declare global {
    interface AsyncContext<T> {
        get name(): string;
        run<R>(value: T, callback: () => R): R;
        get(): T | undefined;
    }

    interface AsyncContextConstructor {
        new <T>(options: AsyncContextOptions<T>): AsyncContext<T>;
        wrap<R, Args extends any[]>(
            callback: (...args: Args) => R
        ): (...args: Args) => R;
    }

    var AsyncContext: AsyncContextConstructor;

    interface AsyncContextOptions<T> {
        name?: string;
        defaultValue?: T;
    }
}
