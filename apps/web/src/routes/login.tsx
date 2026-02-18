import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Form } from "@base-ui/react/form";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { useAuth } from "../hooks/useAuth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const [password, setPassword] = useState("");
  const auth = useAuth();
  const navigate = useNavigate();

  if (auth.authenticated) {
    navigate({ to: "/" });
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Breadcrumb</h1>
          <p className="text-sm text-zinc-400">LLM Tracing</p>
        </div>

        <Form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await auth.login(password);
              navigate({ to: "/" });
            } catch {
              // error handled via auth.loginError
            }
          }}
          className="space-y-4"
        >
          <Field.Root name="password">
            <Field.Label className="block text-sm font-medium text-zinc-300">
              Password
            </Field.Label>
            <Field.Control
              render={
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500"
                />
              }
            />
          </Field.Root>

          {auth.loginError && (
            <p className="text-sm text-red-400">{auth.loginError.message}</p>
          )}

          <button
            type="submit"
            className="w-full rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
          >
            Sign in
          </button>
        </Form>
      </div>
    </div>
  );
}
