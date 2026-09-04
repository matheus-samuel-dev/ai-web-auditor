import { useEffect, useState } from "react";
import { fetchAsset } from "../api/client";

interface AuthorizedAssetState {
  assetUrl: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  errorStatus: number | null;
}

export function useAuthorizedAsset(path?: string | null): AuthorizedAssetState {
  const [state, setState] = useState<AuthorizedAssetState>({
    assetUrl: null,
    isLoading: false,
    errorMessage: null,
    errorStatus: null
  });

  useEffect(() => {
    if (!path) {
      setState({
        assetUrl: null,
        isLoading: false,
        errorMessage: null,
        errorStatus: null
      });
      return;
    }

    let objectUrl = "";
    let active = true;
    const controller = new AbortController();

    setState({
      assetUrl: null,
      isLoading: true,
      errorMessage: null,
      errorStatus: null
    });

    fetchAsset(path, controller.signal)
      .then((blob) => {
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setState({
          assetUrl: objectUrl,
          isLoading: false,
          errorMessage: null,
          errorStatus: null
        });
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState({
          assetUrl: null,
          isLoading: false,
          errorMessage: error instanceof Error ? error.message : "Não foi possível carregar o artefato.",
          errorStatus:
            error && typeof error === "object" && "status" in error && typeof error.status === "number"
              ? error.status
              : null
        });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path]);

  return state;
}
