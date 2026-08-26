import { setupServer } from "msw/node";
import { handlers } from "@/shared/mocks/handlers";

export const server = setupServer(...handlers);
