import { Profile } from "@prisma/client";
import {
  ActionFunction,
  LoaderFunction,
  useLoaderData,
  useParams,
} from "remix";
import { makeDomainFunction } from "remix-domains";
import { Form as RemixForm, formAction } from "remix-forms";
import { badRequest, forbidden, notFound } from "remix-utils";
import { z } from "zod";
import { getUserByRequest } from "~/auth.server";
import Input from "~/components/FormElements/Input/Input";
import { getInitials } from "~/lib/profile/getInitials";
import {
  deleteOrganizationBySlug,
  getOrganizationBySlug,
} from "~/organization.server";
import { getProfileByUserId } from "~/profile.server";
import Header from "~/routes/profile/$username/Header";

const schema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  slug: z.string(),
  confirmedToken: z
    .string()
    .regex(/wirklich löschen/, 'Bitte "wirklich löschen" eingeben.'),
});

type LoaderData = {
  profile: Pick<Profile, "id" | "firstName" | "lastName" | "username">;
};

export const loader: LoaderFunction = async ({ request, params }) => {
  const loggedInUser = await getUserByRequest(request);
  if (loggedInUser === null) {
    throw forbidden({ message: "not allowed" });
  }
  const { slug } = params;
  if (slug === undefined || slug === "") {
    throw badRequest({ message: "organization slug must be provided" });
  }
  const organization = await getOrganizationBySlug(slug);
  if (organization === null) {
    throw notFound({ message: "not found" });
  }
  const userIsPrivileged = organization.teamMembers.some(
    (member) => member.profileId === loggedInUser.id && member.isPrivileged
  );
  if (!userIsPrivileged) {
    throw forbidden({ message: "not allowed" });
  }

  const profile = await getProfileByUserId(loggedInUser.id, [
    "id",
    "firstName",
    "lastName",
    "username",
  ]);

  return { profile };
};

const mutation = makeDomainFunction(schema)(async (values) => {
  const organization = await getOrganizationBySlug(values.slug);
  if (organization === null) {
    throw "Die zu löschende Organisation konnte nicht gefunden werden.";
  }
  const userIsPrivileged = organization.teamMembers.some(
    (member) => member.profileId === values.id && member.isPrivileged
  );
  if (!userIsPrivileged) {
    throw "Für das löschen einer Organisation werden Adminrechte benötigt.";
  }
  console.log("SLUG", values.slug);
  try {
    await deleteOrganizationBySlug(values.slug);
  } catch {
    throw "Die Organisation konnte nicht gelöscht werden.";
  }
  return values;
});

export const action: ActionFunction = async ({ request, params }) => {
  const loggedInUser = await getUserByRequest(request);
  const requestClone = request.clone();
  const formData = await requestClone.formData();

  const formUserId = formData.get("id");
  if (loggedInUser === null || formUserId !== loggedInUser.id) {
    throw forbidden({ message: "not allowed" });
  }

  const username = formData.get("username");
  if (username === null) {
    throw badRequest({ message: "username must be provided" });
  }

  const formActionResult = formAction({
    request,
    schema,
    mutation,
    successPath: `/profile/${username}`,
  });
  return formActionResult;
};

export default function Delete() {
  const { profile } = useLoaderData<LoaderData>();
  const { slug } = useParams();
  const initials = getInitials(profile);
  return (
    <>
      <Header username={profile.username} initials={initials} />

      <div className="container mx-auto px-4 relative z-10 pb-44">
        <div className="flex flex-col lg:flex-row -mx-4">
          <div className="md:flex md:flex-row px-4 pt-10 lg:pt-0">
            <div className="basis-4/12 px-4">
              {/** TODO: Add OrganizationMenu (Equivalent to ProfileMenu) */}
            </div>
            <div className="basis-6/12 px-4">
              <h1 className="mb-8">Organisation löschen</h1>

              <h4 className="mb-4 font-semibold">Allgemein</h4>

              <p className="mb-8">
                Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed
                diam nonumy eirmod tempor invidunt ut labore et dolore magna
                aliquyam erat, sed diam voluptua.
              </p>

              <RemixForm method="post" schema={schema}>
                {({ Field, Button, Errors, register }) => (
                  <>
                    <Field name="confirmedToken" className="mb-4">
                      {({ Errors }) => (
                        <>
                          <Input
                            id="confirmedToken"
                            label="Löschung bestätigen"
                            placeholder="wirklich löschen"
                            {...register("confirmedToken")}
                          />
                          <Errors />
                        </>
                      )}
                    </Field>
                    <Field name="id">
                      {({ Errors }) => (
                        <>
                          <input
                            type="hidden"
                            value={profile.id}
                            {...register("id")}
                          ></input>
                          <Errors />
                        </>
                      )}
                    </Field>
                    <Field name="username">
                      {({ Errors }) => (
                        <>
                          <input
                            type="hidden"
                            value={profile.username}
                            {...register("username")}
                          ></input>
                          <Errors />
                        </>
                      )}
                    </Field>
                    <Field name="slug">
                      {({ Errors }) => (
                        <>
                          <input
                            type="hidden"
                            value={slug || ""}
                            {...register("slug")}
                          ></input>
                          <Errors />
                        </>
                      )}
                    </Field>
                    <button
                      type="submit"
                      className="btn btn-outline-primary ml-auto btn-small"
                    >
                      Organisation endgültig löschen
                    </button>
                    <Errors />
                  </>
                )}
              </RemixForm>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}