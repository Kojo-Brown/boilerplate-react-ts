import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/test/mocks/server";
import { renderWithProviders } from "@/test/renderWithProviders";
import { useGetPostsQuery, useGetPostQuery, useCreatePostMutation, type Post } from "./postsApi";

const API = "http://localhost:4000";

const mockPosts: Post[] = [
  { id: 1, title: "First Post", body: "Content one", userId: 1 },
  { id: 2, title: "Second Post", body: "Content two", userId: 1 },
];

function PostsList() {
  const { data, isLoading, isError } = useGetPostsQuery();
  if (isLoading) return <p>Loading...</p>;
  if (isError) return <p>Error loading posts</p>;
  return (
    <ul>
      {data?.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}

function SinglePost({ id }: { id: number }) {
  const { data, isLoading } = useGetPostQuery(id);
  if (isLoading) return <p>Loading...</p>;
  return <p>{data?.title ?? "No title"}</p>;
}

function CreatePostButton() {
  const [createPost, { isLoading, isSuccess }] = useCreatePostMutation();
  return (
    <div>
      <button onClick={() => createPost({ title: "New Post", body: "New body", userId: 1 })}>
        Create
      </button>
      {isLoading && <p>Creating...</p>}
      {isSuccess && <p>Created!</p>}
    </div>
  );
}

describe("postsApi — useGetPostsQuery", () => {
  it("shows loading then renders post list", async () => {
    server.use(http.get(`${API}/posts`, () => HttpResponse.json(mockPosts)));
    renderWithProviders(<PostsList />);

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("First Post")).toBeInTheDocument();
      expect(screen.getByText("Second Post")).toBeInTheDocument();
    });
  });

  it("shows error state on server failure", async () => {
    server.use(
      http.get(`${API}/posts`, () => HttpResponse.json({ error: "Server error" }, { status: 500 })),
    );
    renderWithProviders(<PostsList />);

    await waitFor(() => {
      expect(screen.getByText("Error loading posts")).toBeInTheDocument();
    });
  });
});

describe("postsApi — useGetPostQuery", () => {
  it("fetches and renders a single post", async () => {
    const post = mockPosts[0];
    if (!post) throw new Error("mockPosts[0] is undefined");

    server.use(http.get(`${API}/posts/1`, () => HttpResponse.json(post)));
    renderWithProviders(<SinglePost id={1} />);

    await waitFor(() => {
      expect(screen.getByText("First Post")).toBeInTheDocument();
    });
  });
});

describe("postsApi — useCreatePostMutation", () => {
  it("calls create endpoint and shows success", async () => {
    const created: Post = { id: 3, title: "New Post", body: "New body", userId: 1 };
    server.use(http.post(`${API}/posts`, () => HttpResponse.json(created, { status: 201 })));

    const { getByRole } = renderWithProviders(<CreatePostButton />);
    getByRole("button", { name: "Create" }).click();

    await waitFor(() => {
      expect(screen.getByText("Created!")).toBeInTheDocument();
    });
  });
});
