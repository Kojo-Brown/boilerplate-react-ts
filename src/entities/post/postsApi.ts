import { baseApi } from "@/shared/api/baseApi";

export interface Post {
  id: number;
  title: string;
  body: string;
  userId: number;
}

export interface CreatePostInput {
  title: string;
  body: string;
  userId: number;
}

export const postsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getPosts: builder.query<Post[], void>({
      query: () => "/posts",
      providesTags: (result) =>
        result
          ? [
              ...result.map(({ id }) => ({ type: "Post" as const, id })),
              { type: "Post" as const, id: "LIST" },
            ]
          : [{ type: "Post" as const, id: "LIST" }],
    }),

    getPost: builder.query<Post, number>({
      query: (id) => `/posts/${id}`,
      providesTags: (_, __, id) => [{ type: "Post", id }],
    }),

    createPost: builder.mutation<Post, CreatePostInput>({
      query: (body) => ({ url: "/posts", method: "POST", body }),
      invalidatesTags: [{ type: "Post", id: "LIST" }],
    }),

    updatePost: builder.mutation<Post, Post>({
      query: ({ id, ...patch }) => ({ url: `/posts/${id}`, method: "PUT", body: patch }),
      invalidatesTags: (_, __, { id }) => [{ type: "Post", id }],
    }),

    deletePost: builder.mutation<void, number>({
      query: (id) => ({ url: `/posts/${id}`, method: "DELETE" }),
      invalidatesTags: (_, __, id) => [{ type: "Post", id }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetPostsQuery,
  useGetPostQuery,
  useCreatePostMutation,
  useUpdatePostMutation,
  useDeletePostMutation,
} = postsApi;
