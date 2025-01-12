import type { ActionArgs, LinksFunction, LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useParams,
  useTransition,
} from "@remix-run/react";
import React from "react";
import { FormProvider, useForm } from "react-hook-form";
import quillStyles from "react-quill/dist/quill.snow.css";
import { badRequest, notFound, serverError } from "remix-utils";
import type { InferType } from "yup";
import { array, object, string } from "yup";
import { createAuthClient, getSessionUserOrThrow } from "~/auth.server";
import InputAdd from "~/components/FormElements/InputAdd/InputAdd";
import InputText from "~/components/FormElements/InputText/InputText";
import SelectAdd from "~/components/FormElements/SelectAdd/SelectAdd";
import SelectField from "~/components/FormElements/SelectField/SelectField";
import TextAreaWithCounter from "~/components/FormElements/TextAreaWithCounter/TextAreaWithCounter";
import {
  createAreaOptionFromData,
  objectListOperationResolver,
} from "~/lib/utils/components";
import { invariantResponse } from "~/lib/utils/response";
import { getParamValueOrThrow } from "~/lib/utils/routes";
import { socialMediaServices } from "~/lib/utils/socialMediaServices";
import type { FormError } from "~/lib/utils/yup";
import {
  getFormValues,
  multiline,
  nullOrString,
  phone,
  social,
  validateForm,
  website,
} from "~/lib/utils/yup";
import { getAllOffers } from "~/routes/utils.server";
import { getAreas } from "~/utils.server";
import {
  deriveProfileMode,
  getProfileVisibilitiesById,
  getWholeProfileFromUsername,
  updateProfileById,
} from "../utils.server";
import { getProfileByUsername } from "./general.server";

const profileSchema = object({
  academicTitle: nullOrString(string()),
  position: nullOrString(string()),
  firstName: string().required("Bitte gib Deinen Vornamen ein."),
  lastName: string().required("Bitte gib Deinen Nachnamen ein."),
  email: string().email().required(),
  phone: nullOrString(phone()),
  bio: nullOrString(multiline()),
  areas: array(string().required()).required(),
  skills: array(string().required()).required(),
  offers: array(string().required()).required(),
  interests: array(string().required()).required(),
  seekings: array(string().required()).required(),
  privateFields: array(string().required()).required(),
  website: nullOrString(website()),
  facebook: nullOrString(social("facebook")),
  linkedin: nullOrString(social("linkedin")),
  twitter: nullOrString(social("twitter")),
  youtube: nullOrString(social("youtube")),
  instagram: nullOrString(social("instagram")),
  xing: nullOrString(social("xing")),
});

type ProfileSchemaType = typeof profileSchema;
export type ProfileFormType = InferType<typeof profileSchema>;

function makeFormProfileFromDbProfile(
  dbProfile: NonNullable<
    Awaited<ReturnType<typeof getWholeProfileFromUsername>>
  >
) {
  return {
    ...dbProfile,
    areas: dbProfile.areas.map((area) => area.area.id),
    offers: dbProfile.offers.map((offer) => offer.offer.id),
    seekings: dbProfile.seekings.map((seeking) => seeking.offer.id),
  };
}

export const loader = async ({ request, params }: LoaderArgs) => {
  const response = new Response();

  const authClient = createAuthClient(request, response);
  const username = getParamValueOrThrow(params, "username");
  const sessionUser = await getSessionUserOrThrow(authClient);
  const mode = await deriveProfileMode(sessionUser, username);
  invariantResponse(mode === "owner", "Not privileged", { status: 403 });
  const dbProfile = await getWholeProfileFromUsername(username);
  if (dbProfile === null) {
    throw notFound({ message: "profile not found." });
  }
  const profileVisibilities = await getProfileVisibilitiesById(dbProfile.id);
  if (profileVisibilities === null) {
    throw notFound({ message: "profile visbilities not found." });
  }

  const profile = makeFormProfileFromDbProfile(dbProfile);

  const areas = await getAreas();
  const offers = await getAllOffers();

  return json(
    { profile, profileVisibilities, areas, offers },
    { headers: response.headers }
  );
};

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: quillStyles },
];

export const action = async ({ request, params }: ActionArgs) => {
  const response = new Response();

  const authClient = createAuthClient(request, response);
  const username = getParamValueOrThrow(params, "username");
  const sessionUser = await getSessionUserOrThrow(authClient);
  const mode = await deriveProfileMode(sessionUser, username);
  invariantResponse(mode === "owner", "Not privileged", { status: 403 });
  const profile = await getProfileByUsername(username);
  if (profile === null) {
    throw notFound({ message: "profile not found." });
  }
  const formData = await request.clone().formData();
  let parsedFormData = await getFormValues<ProfileSchemaType>(
    request,
    profileSchema
  );

  let errors: FormError | null;
  let data: ProfileFormType;

  try {
    const result = await validateForm<ProfileSchemaType>(
      profileSchema,
      parsedFormData
    );

    errors = result.errors;
    data = result.data;
  } catch (error) {
    console.error(error);
    throw badRequest({ message: "Validation failed" });
  }

  let updated = false;

  const submit = formData.get("submit");
  if (submit === "submit") {
    if (errors === null) {
      try {
        const { privateFields, ...profileData } = data;
        // TODO: fix type issue
        await updateProfileById(profile.id, profileData, privateFields);
        updated = true;
      } catch (error) {
        console.error(error);
        throw serverError({ message: "Something went wrong on update." });
      }
    }
  } else {
    const listData: (keyof ProfileFormType)[] = [
      "skills",
      "interests",
      "offers",
      "seekings",
      "areas",
    ];

    listData.forEach((name) => {
      data = objectListOperationResolver<ProfileFormType>(data, name, formData);
    });
  }
  return json(
    {
      profile: data,
      lastSubmit: (formData.get("submit") as string) ?? "",
      errors,
      updated,
    },
    { headers: response.headers }
  );
};

export default function Index() {
  const { username } = useParams();
  const transition = useTransition();
  const {
    profile: dbProfile,
    areas,
    offers,
    profileVisibilities,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const profile = actionData?.profile ?? dbProfile;

  const formRef = React.createRef<HTMLFormElement>();
  const isSubmitting = transition.state === "submitting";
  const errors = actionData?.errors;
  const methods = useForm<ProfileFormType>({
    defaultValues: profile,
  });

  const areaOptions = createAreaOptionFromData(areas);
  const offerOptions = offers.map((o) => ({
    label: o.title,
    value: o.id,
  }));

  const {
    register,
    reset,
    formState: { isDirty },
  } = methods;

  const selectedAreas =
    profile.areas && areas
      ? areas
          .filter((area) => profile.areas.includes(area.id))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

  const selectedOffers =
    profile.offers && offers
      ? offers
          .filter((offer) => profile.offers.includes(offer.id))
          .sort((a, b) => a.title.localeCompare(b.title))
      : [];

  const selectedSeekings =
    profile.seekings && offers
      ? offers
          .filter((offer) => profile.seekings.includes(offer.id))
          .sort((a, b) => a.title.localeCompare(b.title))
      : [];

  React.useEffect(() => {
    if (isSubmitting) {
      const $inputsToClear =
        formRef?.current?.getElementsByClassName("clear-after-submit");
      if ($inputsToClear) {
        Array.from($inputsToClear).forEach(
          // TODO: can this type assertion be removed and proofen by code?
          (a) => ((a as HTMLInputElement).value = "")
        );
      }
    }
  }, [isSubmitting, formRef]);

  React.useEffect(() => {
    if (
      actionData?.lastSubmit === "submit" &&
      actionData?.errors !== undefined &&
      actionData?.errors !== null
    ) {
      const errorElement = document.getElementsByName(
        Object.keys(actionData.errors)[0]
      );
      const yPosition =
        errorElement[0].getBoundingClientRect().top -
        document.body.getBoundingClientRect().top -
        window.innerHeight / 2;
      window.scrollTo(0, yPosition);

      errorElement[0].focus({ preventScroll: true });
    }
  }, [actionData]);

  const isFormChanged = isDirty || actionData?.updated === false;

  return (
    <>
      <FormProvider {...methods}>
        <Form
          ref={formRef}
          name="profileForm"
          method="post"
          onSubmit={(e: React.SyntheticEvent) => {
            reset({}, { keepValues: true });
          }}
        >
          <fieldset disabled={transition.state === "submitting"}>
            <h1 className="mb-8">Persönliche Daten</h1>

            <h4 className="mb-4 font-semibold">Allgemein</h4>

            <p className="mb-8">
              Welche Informationen möchtest Du über Dich mit der Community
              teilen? Über das Augen-Symbol kannst Du auswählen, ob die
              Informationen für alle öffentlich sichtbar sind oder ob Du sie nur
              mit registrierten Nutzer:innen teilst.
            </p>

            <div className="flex flex-col md:flex-row -mx-4">
              <div className="basis-full md:basis-6/12 px-4 mb-4">
                <SelectField
                  {...register("academicTitle")}
                  label="Titel"
                  options={[
                    {
                      label: "Dr.",
                      value: "Dr.",
                    },
                    {
                      label: "Prof.",
                      value: "Prof.",
                    },
                    {
                      label: "Prof. Dr.",
                      value: "Prof. Dr.",
                    },
                  ]}
                  withPublicPrivateToggle={false}
                  isPublic={profileVisibilities.academicTitle}
                  defaultValue={profile.academicTitle || ""}
                />
              </div>
              <div className="basis-full md:basis-6/12 px-4 mb-4">
                <InputText
                  {...register("position")}
                  id="position"
                  label="Position"
                  withPublicPrivateToggle={true}
                  isPublic={profileVisibilities.position}
                  errorMessage={errors?.position?.message}
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row -mx-4">
              <div className="basis-full md:basis-6/12 px-4 mb-4">
                <InputText
                  {...register("firstName")}
                  id="firstName"
                  label="Vorname"
                  required
                  withPublicPrivateToggle={false}
                  isPublic={profileVisibilities.firstName}
                  errorMessage={errors?.firstName?.message}
                />
              </div>
              <div className="basis-full md:basis-6/12 px-4 mb-4">
                <InputText
                  {...register("lastName")}
                  id="lastName"
                  label="Nachname"
                  required
                  withPublicPrivateToggle={false}
                  isPublic={profileVisibilities.lastName}
                  errorMessage={errors?.lastName?.message}
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row -mx-4">
              <div className="basis-full md:basis-6/12 px-4 mb-4">
                <InputText
                  {...register("email")}
                  type="text"
                  id="email"
                  label="E-Mail"
                  readOnly
                  withPublicPrivateToggle={true}
                  isPublic={profileVisibilities.email}
                  errorMessage={errors?.email?.message}
                />
              </div>
              <div className="basis-full md:basis-6/12 px-4 mb-4">
                <InputText
                  {...register("phone")}
                  id="phone"
                  label="Telefon"
                  withPublicPrivateToggle={true}
                  isPublic={profileVisibilities.phone}
                  errorMessage={errors?.phone?.message}
                />
              </div>
            </div>

            <hr className="border-neutral-400 my-10 lg:my-16" />

            <div className="flex flex-row items-center mb-4">
              <h4 className="font-semibold">Über mich</h4>
            </div>

            <p className="mb-8">
              Erzähl der Community etwas über Dich: Wer bist Du und was machst
              Du konkret im MINT-Bereich? In welchen Regionen Deutschlands bist
              Du vorrangig aktiv? Welche Kompetenzen bringst Du mit und welche
              Themen interessieren Dich im MINT-Kontext besonders?
            </p>

            <div className="mb-4">
              <TextAreaWithCounter
                {...register("bio")}
                id="bio"
                label="Kurzbeschreibung"
                defaultValue={profile.bio || ""}
                placeholder="Beschreibe Dich und Dein Tätigkeitsfeld näher."
                withPublicPrivateToggle={true}
                isPublic={profileVisibilities.bio}
                errorMessage={errors?.bio?.message}
                maxCharacters={500}
                rte
              />
            </div>

            <div className="mb-4">
              <SelectAdd
                name="areas"
                label={"Aktivitätsgebiete"}
                placeholder="Füge Regionen hinzu, in denen Du aktiv bist."
                entries={selectedAreas.map((area) => ({
                  label: area.name,
                  value: area.id,
                }))}
                options={areaOptions}
                withPublicPrivateToggle={false}
                isPublic={profileVisibilities.areas}
              />
            </div>

            <div className="mb-4">
              <InputAdd
                name="skills"
                label="Kompetenzen"
                placeholder="Füge Deine Kompetenzen hinzu."
                entries={profile.skills ?? []}
                withPublicPrivateToggle={true}
                isPublic={profileVisibilities.skills}
              />
            </div>

            <div className="mb-4">
              <InputAdd
                name="interests"
                label="Interessen"
                placeholder="Füge Deine Interessen hinzu."
                entries={profile.interests ?? []}
                withPublicPrivateToggle={true}
                isPublic={profileVisibilities.interests}
              />
            </div>

            <hr className="border-neutral-400 my-10 lg:my-16" />
            <h4 className="mb-4 font-semibold">Ich biete</h4>

            <p className="mb-8">
              Was bringst Du mit, wovon die Community profitieren kann? Wie
              kannst Du andere Mitglieder unterstützen?
            </p>

            <div className="mb-4">
              <SelectAdd
                name="offers"
                label="Angebot"
                entries={selectedOffers.map((area) => ({
                  label: area.title,
                  value: area.id,
                }))}
                options={offerOptions.filter(
                  (o) => !profile.offers.includes(o.value)
                )}
                placeholder="Füge Deine Angebote hinzu."
                withPublicPrivateToggle={true}
                isPublic={profileVisibilities.offers}
              />
            </div>

            <hr className="border-neutral-400 my-10 lg:my-16" />

            <h4 className="mb-4 font-semibold">Ich suche</h4>

            <p className="mb-8">
              Wonach suchst Du? Wie können Dich andere Mitglieder unterstützen?
            </p>

            <div className="mb-4">
              <SelectAdd
                name="seekings"
                label="Suche"
                entries={selectedSeekings.map((area) => ({
                  label: area.title,
                  value: area.id,
                }))}
                options={offerOptions.filter(
                  (o) => !profile.seekings.includes(o.value)
                )}
                placeholder="Füge hinzu wonach Du suchst."
                withPublicPrivateToggle={true}
                isPublic={profileVisibilities.seekings}
              />
            </div>

            <hr className="border-neutral-400 my-10 lg:my-16" />

            <h2 className="mb-8">Website und Soziale Netzwerke</h2>

            <h4 className="mb-4 font-semibold">Website</h4>

            <p className="mb-8">
              Wo kann die Community mehr über Dich und Dein Angebot erfahren?
            </p>

            <div className="basis-full mb-4">
              <InputText
                {...register("website")}
                id="website"
                label="Website"
                placeholder="domainname.tld"
                withPublicPrivateToggle={true}
                isPublic={profileVisibilities.website}
                errorMessage={errors?.website?.message}
                withClearButton
              />
            </div>

            <hr className="border-neutral-400 my-10 lg:my-16" />

            <h4 className="mb-4 font-semibold">Soziale Netzwerke</h4>

            <p className="mb-8">
              Wo kann die Community in Kontakt mit Dir treten?
            </p>

            {socialMediaServices.map((service) => (
              <div className="w-full mb-4" key={service.id}>
                <InputText
                  {...register(service.id)}
                  id={service.id}
                  label={service.label}
                  placeholder={service.placeholder}
                  withPublicPrivateToggle={true}
                  isPublic={profileVisibilities[service.id]}
                  errorMessage={errors?.[service.id]?.message}
                  withClearButton
                />
              </div>
            ))}

            <hr className="border-neutral-400 my-10 lg:my-16" />

            <div className="flex flex-row items-center mb-4">
              <h4 className="font-semibold">
                Organisation oder Netzwerk hinzufügen
              </h4>
              <Link
                to="/organization/create"
                className="btn btn-outline-primary ml-auto btn-small"
              >
                Organisation anlegen
              </Link>
            </div>
            <p className="mb-8">
              Die Organisation oder das Netzwerk, in dem Du tätig bist, hat noch
              kein Profil? Füge es direkt hinzu, damit auch andere Mitglieder
              über darüber erfahren können.
              <br />
              <br />
              Falls die Organisation bereits existiert, melde dich bei der
              Person, die diese angelegt hat.
              <br />
              <br />
              Zukünfig wirst du dich selbstständig zu Organisationen hinzufügen
              können.
            </p>

            <footer className="fixed bg-white border-t-2 border-primary w-full inset-x-0 bottom-0 pb-24 md:pb-0">
              <div className="container">
                <div className="flex flex-row flex-nowrap items-center justify-end my-4">
                  <div
                    className={`text-green-500 text-bold ${
                      actionData?.updated && !isSubmitting
                        ? "block animate-fade-out"
                        : "hidden"
                    }`}
                  >
                    Dein Profil wurde aktualisiert.
                  </div>

                  {isFormChanged ? (
                    <Link
                      to={`/profile/${username}/settings`}
                      reloadDocument
                      className={`btn btn-link`}
                    >
                      Änderungen verwerfen
                    </Link>
                  ) : null}
                  <div></div>
                  <button
                    type="submit"
                    name="submit"
                    value="submit"
                    className="btn btn-primary ml-4"
                    disabled={isSubmitting || !isFormChanged}
                  >
                    Speichern
                  </button>
                </div>
              </div>
            </footer>
          </fieldset>
        </Form>
      </FormProvider>
    </>
  );
}
