import { useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  UseMutationOptions,
  QueryKey,
  MutationFunction,
} from '@tanstack/react-query'

interface UseOptimisticMutationOptions<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = unknown
> {
  /**
   * The mutation function to execute
   */
  mutationFn: MutationFunction<TData, TVariables>

  /**
   * The query key to optimistically update
   */
  queryKey: QueryKey

  /**
   * Function to compute the optimistic update.
   * Receives the current cached data and mutation variables,
   * returns the optimistically updated data.
   */
  optimisticUpdate: (oldData: TData | undefined, variables: TVariables) => TData

  /**
   * Optional success callback
   */
  onSuccess?: UseMutationOptions<TData, TError, TVariables, TContext>['onSuccess']

  /**
   * Optional error callback
   */
  onError?: UseMutationOptions<TData, TError, TVariables, TContext>['onError']

  /**
   * Optional settled callback (runs after success or error)
   */
  onSettled?: UseMutationOptions<TData, TError, TVariables, TContext>['onSettled']
}

/**
 * Wraps TanStack Query's `useMutation` to provide optimistic updates with automatic rollback on error.
 *
 * **Usage:**
 * ```tsx
 * const mutation = useOptimisticMutation({
 *   mutationFn: async (newTodo: Todo) => api.createTodo(newTodo),
 *   queryKey: ['todos'],
 *   optimisticUpdate: (oldTodos = [], newTodo) => [...oldTodos, newTodo],
 *   onSuccess: () => toast.success('Todo created!'),
 * })
 * ```
 *
 * **Features:**
 * - Cancels in-flight queries before applying optimistic update
 * - Snapshots previous data into context for rollback on error
 * - Re-fetches query on settled (success or error) to ensure sync with server
 *
 * @template TData - The type of data returned by the mutation and stored in cache
 * @template TError - The type of error thrown by the mutation
 * @template TVariables - The type of variables passed to the mutation function
 * @template TContext - The type of context (typically `{ previousData: TData | undefined }`)
 */
export function useOptimisticMutation<
  TData = unknown,
  TError = unknown,
  TVariables = void,
  TContext = { previousData: TData | undefined }
>(
  options: UseOptimisticMutationOptions<TData, TError, TVariables, TContext>
) {
  const queryClient = useQueryClient()
  const { mutationFn, queryKey, optimisticUpdate, onSuccess, onError, onSettled } = options

  return useMutation<TData, TError, TVariables, TContext>({
    mutationFn,

    // Before mutation: cancel in-flight queries, snapshot previous data, apply optimistic update
    onMutate: async (variables: TVariables) => {
      // Cancel any outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({ queryKey })

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<TData>(queryKey)

      // Optimistically update the cache
      queryClient.setQueryData<TData>(queryKey, (old) => optimisticUpdate(old, variables))

      // Return context with snapshot for potential rollback
      return { previousData } as TContext
    },

    // On error: rollback to the previous data
    onError: (error, variables, context, mutationFunctionContext) => {
      // Rollback to the snapshot
      if (context && typeof context === 'object' && 'previousData' in (context as object)) {
        queryClient.setQueryData(queryKey, (context as unknown as { previousData: TData | undefined }).previousData)
      }

      // Call user's error handler if provided
      onError?.(error, variables, context, mutationFunctionContext)
    },

    // On success: call user's success handler
    onSuccess,

    // On settled (success or error): refetch to sync with server
    onSettled: async (data, error, variables, context, mutationFunctionContext) => {
      // Invalidate and refetch to ensure cache is in sync with server
      await queryClient.invalidateQueries({ queryKey })

      // Call user's settled handler if provided
      onSettled?.(data, error, variables, context, mutationFunctionContext)
    },
  })
}
