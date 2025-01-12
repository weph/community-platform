import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useFetcher,
  useLoaderData,
  useParams,
  useSearchParams,
  useSubmit,
} from "@remix-run/react";
import { GravityType } from "imgproxy/dist/types";
import { Form } from "remix-forms";
import { createAuthClient, getSessionUserOrThrow } from "~/auth.server";
import Autocomplete from "~/components/Autocomplete/Autocomplete";
import { H3 } from "~/components/Heading/Heading";
import { getImageURL } from "~/images.server";
import { getInitials } from "~/lib/profile/getInitials";
import { invariantResponse } from "~/lib/utils/response";
import { getParamValueOrThrow } from "~/lib/utils/routes";
import { getProfileSuggestionsForAutocomplete } from "~/routes/utils.server";
import { getPublicURL } from "~/storage.server";
import { deriveProjectMode } from "../../utils.server";
import { getProject } from "./admins.server";
import {
  addAdminSchema,
  type action as addAdminAction,
} from "./admins/add-admin";
import {
  removeAdminSchema,
  type action as removeAdminAction,
} from "./admins/remove-admin";

export const loader = async (args: LoaderArgs) => {
  const { request, params } = args;
  const response = new Response();
  const authClient = createAuthClient(request, response);
  const sessionUser = await getSessionUserOrThrow(authClient);
  const slug = getParamValueOrThrow(params, "slug");
  const project = await getProject(slug);
  invariantResponse(project, "Project not found", { status: 404 });
  const mode = await deriveProjectMode(sessionUser, slug);
  invariantResponse(mode === "admin", "Not privileged", { status: 403 });

  const enhancedAdmins = project.admins.map((relation) => {
    let avatar = relation.profile.avatar;
    if (avatar !== null) {
      const publicURL = getPublicURL(authClient, avatar);
      if (publicURL !== null) {
        avatar = getImageURL(publicURL, {
          resize: { type: "fill", width: 64, height: 64 },
          gravity: GravityType.center,
        });
      }
    }
    return { ...relation.profile, avatar };
  });

  const url = new URL(request.url);
  const suggestionsQuery =
    url.searchParams.get("autocomplete_query") || undefined;
  let adminSuggestions;
  if (suggestionsQuery !== undefined && suggestionsQuery !== "") {
    const query = suggestionsQuery.split(" ");
    const alreadyAdminIds = project.admins.map((relation) => {
      return relation.profile.id;
    });
    adminSuggestions = await getProfileSuggestionsForAutocomplete(
      authClient,
      alreadyAdminIds,
      query
    );
  }

  return json(
    {
      admins: enhancedAdmins,
      adminSuggestions,
    },
    { headers: response.headers }
  );
};

function Admins() {
  const { slug } = useParams();
  const loaderData = useLoaderData<typeof loader>();
  const addAdminFetcher = useFetcher<typeof addAdminAction>();
  const removeAdminFetcher = useFetcher<typeof removeAdminAction>();
  const [searchParams] = useSearchParams();
  const suggestionsQuery = searchParams.get("autocomplete_query");
  const submit = useSubmit();

  return (
    <>
      <h1 className="mb-8">Die Administrator:innen</h1>
      <p className="mb-2">
        Wer verwaltet das Projekt auf der Community Plattform? Füge hier weitere
        Administrator:innen hinzu oder entferne sie.
      </p>
      <p className="mb-2">
        Administrator:innen können Projekte bearbeiten, veröffentlichen oder
        löschen. Sie sind nicht auf der Projekt-Detailseite sichtbar.
      </p>
      <p className="mb-8">
        Team-Mitglieder werden auf der Projekt-Detailseite gezeigt. Sie können
        Events im Entwurf einsehen, diese aber nicht bearbeiten.
      </p>
      <h4 className="mb-4 mt-4 font-semibold">Administrator:in hinzufügen</h4>
      <p className="mb-8">
        Füge hier Deinem Projekt ein bereits bestehendes Profil hinzu.
      </p>
      <Form
        schema={addAdminSchema}
        fetcher={addAdminFetcher}
        action={`/project/${slug}/settings/admins/add-admin`}
        onSubmit={() => {
          submit({
            method: "get",
            action: `/project/${slug}/settings/admins`,
          });
        }}
      >
        {({ Field, Errors, Button, register }) => {
          return (
            <>
              <Errors />
              <div className="form-control w-full">
                <div className="flex flex-row items-center mb-2">
                  <div className="flex-auto">
                    <label id="label-for-name" htmlFor="Name" className="label">
                      Name oder Email
                    </label>
                  </div>
                </div>

                <div className="flex flex-row">
                  <Field name="profileId" className="flex-auto">
                    {({ Errors }) => (
                      <>
                        <Errors />
                        <Autocomplete
                          suggestions={loaderData.adminSuggestions || []}
                          suggestionsLoaderPath={`/project/${slug}/settings/admins`}
                          defaultValue={suggestionsQuery || ""}
                          {...register("profileId")}
                          searchParameter="autocomplete_query"
                        />
                      </>
                    )}
                  </Field>
                  <div className="ml-2">
                    <Button className="bg-transparent w-10 h-8 flex items-center justify-center rounded-md border border-neutral-500 text-neutral-600 mt-0.5">
                      +
                    </Button>
                  </div>
                </div>
              </div>
            </>
          );
        }}
      </Form>
      {addAdminFetcher.data !== undefined &&
      "message" in addAdminFetcher.data ? (
        <div className={`p-4 bg-green-200 rounded-md mt-4`}>
          {addAdminFetcher.data.message}
        </div>
      ) : null}
      <h4 className="mb-4 mt-16 font-semibold">Aktuelle Administrator:innen</h4>
      <p className="mb-8">
        Hier siehst du alle Administrator:innen des Projekts auf einen Blick.{" "}
      </p>
      <div className="mb-4 md:max-h-[630px] overflow-auto">
        {loaderData.admins.map((admin) => {
          const initials = getInitials(admin);
          return (
            <div
              key={`team-member-${admin.id}`}
              className="w-full flex items-center flex-row flex-wrap sm:flex-nowrap border-b border-neutral-400 py-4 md:px-4"
            >
              <div className="h-16 w-16 bg-primary text-white text-3xl flex items-center justify-center rounded-full border overflow-hidden shrink-0">
                {admin.avatar !== null && admin.avatar !== "" ? (
                  <img src={admin.avatar} alt={initials} />
                ) : (
                  <>{initials}</>
                )}
              </div>
              <div className="pl-4">
                <Link to={`/profile/${admin.username}`}>
                  <H3
                    like="h4"
                    className="text-xl mb-1 no-underline hover:underline"
                  >
                    {admin.firstName} {admin.lastName}
                  </H3>
                </Link>
                {admin.position ? (
                  <p className="font-bold text-sm cursor-default">
                    {admin.position}
                  </p>
                ) : null}
              </div>
              <div className="flex-100 sm:flex-auto sm:ml-auto flex items-center flex-row pt-4 sm:pt-0 justify-end">
                <Form
                  schema={removeAdminSchema}
                  fetcher={removeAdminFetcher}
                  action={`/project/${slug}/settings/admins/remove-admin`}
                  hiddenFields={["profileId"]}
                  values={{
                    profileId: admin.id,
                  }}
                >
                  {(props) => {
                    const { Field, Button, Errors } = props;
                    return (
                      <>
                        <Errors />
                        <Field name="profileId" />
                        {loaderData.admins.length > 1 ? (
                          <Button
                            className="ml-auto btn-none"
                            title="entfernen"
                          >
                            <svg
                              viewBox="0 0 10 10"
                              width="10px"
                              height="10px"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M.808.808a.625.625 0 0 1 .885 0L5 4.116 8.308.808a.626.626 0 0 1 .885.885L5.883 5l3.31 3.308a.626.626 0 1 1-.885.885L5 5.883l-3.307 3.31a.626.626 0 1 1-.885-.885L4.116 5 .808 1.693a.625.625 0 0 1 0-.885Z"
                                fill="currentColor"
                              />
                            </svg>
                          </Button>
                        ) : null}
                      </>
                    );
                  }}
                </Form>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default Admins;
