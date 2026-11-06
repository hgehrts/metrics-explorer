declare module '@splunk/search-job' {
    const SearchJob: {
        create: (
            params: { search: string; earliest_time: string; latest_time: string },
            options: { cancelOnUnload: boolean }
        ) => {
            getResults: (params?: { count?: number }) => {
                subscribe: (observer: {
                    next: (payload: { results?: Record<string, unknown>[] }) => void;
                    error: (error: unknown) => void;
                }) => { unsubscribe: () => void };
            };
            cancel: () => void;
        };
    };
    export default SearchJob;
}
