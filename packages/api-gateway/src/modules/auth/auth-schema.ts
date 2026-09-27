import z, { email } from "zod";

export const loginSchema = z.object({
  body: z.strictObject({
    email: z.email("Email is invalid").min(1, "Email is required"),
    password: z.string().min(6, "Password must be at least 6 characters long"),
  }),
});

export const signUpSchema = z.object({
  body: z
    .strictObject({
      email: z.email("Email is invalid").min(1, "Email is required"),
      password: z.string().min(6, "Password must be at least 6 characters long"),
      confirm_password: z.string().min(6, "Password must be at least 6 characters long"),
    })
    .refine((data) => data.password === data.confirm_password, {
      error: "Passwords don't match",
      path: ["confirm_password"],
    }),
});
