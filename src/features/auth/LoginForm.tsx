import { z } from "zod";
import { useZodForm } from "@/shared/hooks/useZodForm";
import { FormField } from "@/shared/ui/FormField";
import { Input } from "@/shared/ui/Input";
import { Button } from "@/shared/ui/Button";

const loginSchema = z.object({
  email: z.email({ message: "Invalid email address" }),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSubmit?: (values: LoginFormValues) => Promise<void>;
}

export function LoginForm({ onSubmit }: LoginFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useZodForm(loginSchema, {
    defaultValues: { email: "", password: "" },
  });

  return (
    <form
      onSubmit={handleSubmit(async (data) => {
        await onSubmit?.(data);
      })}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField label="Email" error={errors.email?.message} required>
        <Input
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          error={!!errors.email}
          {...register("email")}
        />
      </FormField>

      <FormField label="Password" error={errors.password?.message} required>
        <Input
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          error={!!errors.password}
          {...register("password")}
        />
      </FormField>

      <Button type="submit" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
