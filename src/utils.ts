export type Result<A, E> = Result.Success<A> | Result.Error<E>;

export namespace Result {
  export type Success<A> = { type: "success"; value: A };
  export type Error<B> = { type: "error"; error: B };

  export const success = <A>(value: A): Success<A> => ({
    type: "success",
    value,
  });

  export const error = <E>(error: E): Error<E> => ({
    type: "error",
    error,
  });

  export const map = <A, B, C>(
    result: Result<A, B>,
    fn: (value: A) => C
  ): Result<C, B> => {
    return result.type === "success" ? success(fn(result.value)) : result;
  };

  export const catchError = <A, B, C>(
    result: Result<A, B>,
    fn: (value: B) => C
  ): Success<A | C> => {
    return result.type === "error" ? success(fn(result.error)) : result;
  };

  export const andThen = <A, B, C>(
    result: Result<A, B>,
    fn: (value: A) => Result<C, B>
  ): Result<C, B> => {
    return result.type === "success" ? fn(result.value) : result;
  };
}
