import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ROUTES } from "@/router/paths";
import { validateOAuthCallback } from "@/features/auth/oauth";
import { useGoogleExchangeMutation } from "@/features/auth/authApi";
import { PageLoader } from "@/components/ui/PageLoader";

export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [googleExchange] = useGoogleExchangeMutation();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error || !code || !state) {
      void navigate(ROUTES.LOGIN, {
        replace: true,
        state: { oauthError: error ?? "Missing OAuth parameters." },
      });
      return;
    }

    let exchangeParams: { code: string; codeVerifier: string; redirectUri: string };
    try {
      exchangeParams = validateOAuthCallback({ code, state });
    } catch (err) {
      void navigate(ROUTES.LOGIN, {
        replace: true,
        state: {
          oauthError: err instanceof Error ? err.message : "OAuth validation failed.",
        },
      });
      return;
    }

    googleExchange(exchangeParams)
      .unwrap()
      .then(() => {
        void navigate(ROUTES.DASHBOARD, { replace: true });
      })
      .catch(() => {
        void navigate(ROUTES.LOGIN, {
          replace: true,
          state: { oauthError: "Failed to complete sign-in. Please try again." },
        });
      });
  }, [googleExchange, navigate, searchParams]);

  return <PageLoader />;
}
