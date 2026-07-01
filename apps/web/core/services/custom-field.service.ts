/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";
// types
import type { ICustomField, ICustomFieldOption, ICustomFieldValue } from "@/types/custom-field";

export class CustomFieldService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  // ---- field definitions ----
  async getCustomFields(workspaceSlug: string, projectId: string): Promise<ICustomField[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createCustomField(
    workspaceSlug: string,
    projectId: string,
    data: Partial<ICustomField>
  ): Promise<ICustomField> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateCustomField(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<ICustomField>
  ): Promise<ICustomField> {
    return this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/${fieldId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteCustomField(workspaceSlug: string, projectId: string, fieldId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/${fieldId}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // ---- field options (single_select / multi_select) ----
  async createOption(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    data: Partial<ICustomFieldOption>
  ): Promise<ICustomFieldOption> {
    return this.post(`/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/${fieldId}/options/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateOption(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    data: Partial<ICustomFieldOption>
  ): Promise<ICustomFieldOption> {
    return this.patch(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/${fieldId}/options/${optionId}/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteOption(workspaceSlug: string, projectId: string, fieldId: string, optionId: string): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/${fieldId}/options/${optionId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async reorderOptions(
    workspaceSlug: string,
    projectId: string,
    fieldId: string,
    optionIds: string[]
  ): Promise<ICustomFieldOption[]> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/custom-fields/${fieldId}/options/reorder/`,
      { options: optionIds }
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // ---- work item values ----
  async getCustomFieldValues(workspaceSlug: string, projectId: string, issueId: string): Promise<ICustomFieldValue[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/custom-field-values/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async setCustomFieldValue(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: { field: string; value: unknown }
  ): Promise<ICustomFieldValue> {
    return this.post(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/custom-field-values/`,
      data
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async clearCustomFieldValue(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    fieldId: string
  ): Promise<void> {
    return this.delete(
      `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/custom-field-values/${fieldId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
