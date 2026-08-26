import type { HTMLInputAutoCompleteAttribute } from "react";
import { Button } from "@/shared/ui/Button";
import { FormField } from "@/shared/ui/FormField";
import { Input } from "@/shared/ui/Input";
import { Text } from "@/shared/ui/Text";
import type { FieldErrors } from "@/shared/lib/formState";

export interface FieldDescriptor<Field extends string> {
  readonly name: Field;
  readonly label: string;
  readonly placeholder?: string | undefined;
  readonly autoComplete?: HTMLInputAutoCompleteAttribute | undefined;
  readonly inputMode?: "text" | "numeric" | undefined;
}

interface DetailsStepProps<Field extends string> {
  readonly headingId: string;
  readonly heading: string;
  readonly fields: readonly FieldDescriptor<Field>[];
  readonly values: Readonly<Record<Field, string>>;
  readonly errors: FieldErrors<Field>;
  /** The flow-level message: a server rejection attributed to this step. */
  readonly message: string | null;
  readonly onChange: (field: Field, value: string) => void;
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly nextLabel: string;
}

/**
 * The two form steps, which differ only in their fields.
 *
 * Generic in the field union rather than taking `string`, so a descriptor
 * naming a field the machine does not have is a type error at the call site
 * instead of an input whose `onChange` quietly writes to a key nothing reads.
 *
 * The submit handler sends `next` unconditionally. Validation lives in the
 * machine's guard, and the errors arrive back as props — this component has no
 * opinion about whether the form is valid, which is what stops the two
 * implementations from drifting apart.
 */
export function DetailsStep<Field extends string>({
  headingId,
  heading,
  fields,
  values,
  errors,
  message,
  onChange,
  onBack,
  onNext,
  nextLabel,
}: DetailsStepProps<Field>) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <Text as="h2" id={headingId} size="xl" weight="semibold">
        {heading}
      </Text>

      {message !== null && (
        <Text tone="danger" role="alert" data-testid="step-message">
          {message}
        </Text>
      )}

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          // `noValidate` plus an explicit submit: the browser's own validation
          // bubble cannot say what the machine's guard knows, and letting both
          // run means two different refusals for the same click.
          event.preventDefault();
          onNext();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <FormField key={field.name} label={field.label} error={errors[field.name]} required>
              <Input
                name={field.name}
                value={values[field.name]}
                placeholder={field.placeholder}
                autoComplete={field.autoComplete}
                inputMode={field.inputMode}
                error={errors[field.name] !== undefined}
                aria-invalid={errors[field.name] !== undefined}
                onChange={(event) => {
                  onChange(field.name, event.target.value);
                }}
              />
            </FormField>
          ))}
        </div>

        <div className="flex justify-between gap-3">
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button type="submit">{nextLabel}</Button>
        </div>
      </form>
    </section>
  );
}
