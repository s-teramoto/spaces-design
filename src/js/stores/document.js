/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

define(function (require, exports, module) {
    "use strict";

    var Fluxxor = require("fluxxor"),
        Immutable = require("immutable"),
        _ = require("lodash"),
        Promise = require("bluebird");

    var Document = require("../models/document"),
        Guide = require("../models/guide"),
        events = require("../events");

    var DocumentStore = Fluxxor.createStore({

        /**
         * @type {Object.<number, Document>}
         */
        _openDocuments: null,
        
        /**
         * @type {Map.<number, function>}
         */
        _layerIDToStateListener: null,

        initialize: function () {
            this.bindActions(
                events.RESET, this._handleReset,
                events.document.DOCUMENT_UPDATED, this._documentUpdated,
                events.document.SAVE_DOCUMENT, this._handleDocumentSaved,
                events.document.DOCUMENT_RENAMED, this._handleDocumentRenamed,
                events.document.CLOSE_DOCUMENT, this._closeDocument,
                events.document.history.ADD_LAYERS, this._handleLayerAdd,
                events.document.GUIDES_VISIBILITY_CHANGED, this._updateDocumentGuidesVisibility,
                events.document.history.GUIDES_UPDATED, this._handleGuidesUpdated,
                events.document.history.RESET_LAYERS, this._handleLayerReset,
                events.document.history.RESET_LAYERS_BY_INDEX, this._handleLayerResetByIndex,
                events.document.history.RESET_BOUNDS, this._handleBoundsReset,
                events.document.history.REORDER_LAYERS, this._handleLayerReorder,
                events.document.SELECT_LAYERS_BY_ID, this._handleLayerSelectByID,
                events.document.SELECT_LAYERS_BY_INDEX, this._handleLayerSelectByIndex,
                events.document.VISIBILITY_CHANGED, this._handleVisibilityChanged,
                events.document.history.LOCK_CHANGED, this._handleLockChanged,
                events.document.SET_GROUP_EXPANSION, this._handleGroupExpansion,
                events.document.history.OPACITY_CHANGED, this._handleOpacityChanged,
                events.document.history.BLEND_MODE_CHANGED, this._handleBlendModeChanged,
                events.document.history.RENAME_LAYER, this._handleLayerRenamed,
                events.document.history.DELETE_LAYERS, this._handleDeleteLayers,
                events.document.history.GROUP_SELECTED, this._handleGroupLayers,
                events.document.history.UNGROUP_SELECTED, this._handleUngroupLayers,
                events.document.history.REPOSITION_LAYERS, this._handleLayerRepositioned,
                events.document.history.RESIZE_LAYERS, this._handleLayerResized,
                events.document.history.SET_LAYERS_PROPORTIONAL, this._handleSetLayersProportional,
                events.document.history.RESIZE_DOCUMENT, this._handleDocumentResized,
                events.document.history.RADII_CHANGED, this._handleRadiiChanged,
                events.document.history.FILL_COLOR_CHANGED, this._handleFillPropertiesChanged,
                events.document.history.FILL_OPACITY_CHANGED, this._handleFillPropertiesChanged,
                events.document.history.STROKE_ALIGNMENT_CHANGED, this._handleStrokePropertiesChanged,
                events.document.history.STROKE_ENABLED_CHANGED, this._handleStrokePropertiesChanged,
                events.document.history.STROKE_WIDTH_CHANGED, this._handleStrokePropertiesChanged,
                events.document.history.STROKE_CHANGED, this._handleStrokePropertiesChanged,
                events.document.history.STROKE_COLOR_CHANGED, this._handleStrokePropertiesChanged,
                events.document.history.STROKE_OPACITY_CHANGED, this._handleStrokePropertiesChanged,
                events.document.history.STROKE_ADDED, this._handleStrokeAdded,
                events.document.history.LAYER_EFFECT_CHANGED, this._handleLayerEffectPropertiesChanged,
                events.document.history.LAYER_EFFECT_DELETED, this._handleDeletedLayerEffect,
                events.document.history.LAYER_EFFECTS_BATCH_CHANGED, this._handleLayerEffectsBatch,
                events.document.history.TYPE_FACE_CHANGED, this._handleTypeFaceChanged,
                events.document.history.TYPE_SIZE_CHANGED, this._handleTypeSizeChanged,
                events.document.history.TYPE_COLOR_CHANGED, this._handleTypeColorChanged,
                events.document.history.TYPE_TRACKING_CHANGED, this._handleTypeTrackingChanged,
                events.document.history.TYPE_LEADING_CHANGED, this._handleTypeLeadingChanged,
                events.document.history.TYPE_ALIGNMENT_CHANGED, this._handleTypeAlignmentChanged,
                events.document.history.TYPE_PROPERTIES_CHANGED, this._handleTypePropertiesChanged,
                events.document.history.LAYER_EXPORT_ENABLED_CHANGED, this._handleExportEnabledChanged,
                events.document.history.GUIDE_SET, this._handleGuideSet,
                events.document.history.GUIDE_DELETED, this._handleGuideDeleted,
                events.document.history.GUIDES_CLEARED, this._handleGuidesCleared,
                events.document.history.ADD_VECTOR_MASK_TO_LAYER, this._handleVectorMask,
                events.document.history.REMOVE_VECTOR_MASK_FROM_LAYER, this._handleVectorMask
            );

            this._handleReset();
        },

        /**
         * Reset or initialize store state.
         *
         * @private
         */
        _handleReset: function () {
            this._openDocuments = {};
            this._layerIDToStateListener = new Map();
        },

        /**
         * Returns all open documents
         *
         * @return {Iterable.<?Document>}
         */
        getAllDocuments: function () {
            return this._openDocuments;
        },

        /**
         * Returns the document with the given ID; or null if there is none
         *
         * @param {number} id Document ID
         * @return {?Document}
         */
        getDocument: function (id) {
            return this._openDocuments[id] || null;
        },

        /**
         * Construct a document model from a document and array of layer descriptors.
         *
         * @private
         * @param {{document: object, layers: Array.<object>=, guides: Array.<object>=}} docObj
         * @return {Document}
         */
        _makeDocument: function (docObj) {
            var rawDocument = docObj.document,
                rawLayers = docObj.layers,
                rawGuides = docObj.guides;

            return Document.fromDescriptors(rawDocument, rawLayers, rawGuides);
        },

        /**
         * Set a new document model, optionally setting the dirty flag if the
         * model has changed, and emit a change event.
         *
         * @param {Document} nextDocument
         * @param {boolean=} dirty Whether to set the dirty bit, assuming the model has changed
         * @param {boolean=} suppressChange Whether or not to suppress the change event
         * @param {string=} changeEventName The event to emit. Default: "change".
         * @return {Promise}
         */
        setDocument: function (nextDocument, dirty, suppressChange, changeEventName) {
            var promise = Promise.resolve(),
                oldDocument = this._openDocuments[nextDocument.id];

            if (Immutable.is(oldDocument, nextDocument)) {
                return promise;
            }

            if (dirty) {
                nextDocument = nextDocument.set("dirty", true);
            }

            this._openDocuments[nextDocument.id] = nextDocument;

            if (suppressChange) {
                return promise;
            }

            // Notify change of layer state.
            if (oldDocument && oldDocument.layers && nextDocument.layers) {
                oldDocument.layers.layers.forEach(function (layer) {
                    var nextLayer = nextDocument.layers.byID(layer.id),
                        callback = this._layerIDToStateListener[layer.id];

                    // Do not notify the change if the layer is deleted or it does not have a listener (when 
                    // its LayerFace instance is not mounted yet)
                    if (nextLayer && callback &&
                        (layer.selected !== nextLayer.selected || layer.expanded !== nextLayer.expanded)) {
                        callback(nextLayer.selected, nextLayer.expanded);
                    }
                }, this);
            }

            // If some selected layer remains uninitialized, a new document will
            // come along shortly. Wait until then to trigger the change event.
            var initialized = nextDocument.layers && nextDocument.layers.selected
                .every(function (layer) {
                    return layer.initialized;
                });
                
            if (!initialized) {
                return promise;
            }

            return promise
                // Performance Hack: delay emitting the `change` event so that the browser can start rendering for
                // changes made by LayerFace (triggered by the layer state listener callback).
                .delay(0)
                .bind(this)
                .then(function () {
                    // Include the document in the event payload
                    this.emit(changeEventName || "change", nextDocument);
                });
        },

        /**
         * Reset a single document model from the given document and layer descriptors.
         *
         * @private
         * @param {{document: object, layers: Array.<object>, guides: Array.<object>}} payload
         */
        _documentUpdated: function (payload) {
            var doc = this._makeDocument(payload);

            this.setDocument(doc);
        },

        /**
         * Remove a single document model for the given document ID
         *
         * @private
         * @param {{documentID: number}} payload
         */
        _closeDocument: function (payload) {
            var documentID = payload.documentID;

            delete this._openDocuments[documentID];
            
            // Don't emit a change event here because the application store is
            // what should be used to monitor the set of currently open documents.
        },

        /**
         * Unset the dirty bit on the document.
         *
         * @private
         * @param {{documentID: number}} payload
         */
        _handleDocumentSaved: function (payload) {
            var documentID = payload.documentID,
                document = this._openDocuments[documentID];

            this._openDocuments[documentID] = document.set("dirty", false);
            this.emit("change");
        },

        /**
         * Rename the document for the given document ID.
         *
         * @private
         * @param {{documentID: number, name: string}} payload
         */
        _handleDocumentRenamed: function (payload) {
            var documentID = payload.documentID,
                updatedModel = {
                    name: payload.name,
                    format: payload.format
                },
                document = this._openDocuments[documentID],
                nextDocument = document.merge(updatedModel);

            this.setDocument(nextDocument);
        },

        /**
         * Update the bounds of the document
         *
         * @private
         * @param {{documentID: number, size: {w: number, h: number}}} payload
         */
        _handleDocumentResized: function (payload) {
            var documentID = payload.documentID,
                size = payload.size,
                document = this._openDocuments[documentID],
                nextDocument = document.resize(size.w, size.h);

            this.setDocument(nextDocument, true);
        },

        /**
         * Create and add a new layer model, possibly replacing an existing layer model.
         *
         * @private
         * @param {object} payload An object with the following properties:
         *  {
         *      documentID: number,
         *      layerID: Array.<number>,
         *      descriptor: Array.<object>,
         *      selected: boolean,
         *      replace: boolean || number
         *  }
         */
        _handleLayerAdd: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                descriptors = payload.descriptors,
                selected = payload.selected,
                replace = payload.replace,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.addLayers(layerIDs, descriptors, selected, replace, document),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update the visibility of a document's guides or smart guides
         *
         * @private
         * @param {object} payload
         * @param {number} payload.documentID
         * @param {boolean} payload.guidesVisible
         * @param {boolean} payload.smartGuidesVisible
         * @param {Array.<object>=} payload.guides
         */
        _updateDocumentGuidesVisibility: function (payload) {
            var documentID = payload.documentID,
                props = _.pick(payload, ["guidesVisible", "smartGuidesVisible"]),
                document = this._openDocuments[documentID],
                nextDocument = document.merge(props),
                guides = payload.guides;

            this.setDocument(nextDocument, false, !!guides);

            if (guides) {
                this._handleGuidesUpdated(payload);
            }
        },

        /**
         * Reset the given layer models.
         *
         * @private
         * @param {object} payload
         * @param {number} payload.documentID
         * @param {Immutable.Iterable.<{layerID: number, descriptor: object}>} payload.layers
         * @param {boolean=} payload.suppressDirty
         * @param {boolean=} payload.lazy
         */
        _handleLayerReset: function (payload) {
            var documentID = payload.documentID,
                layerObjs = payload.layers,
                document = this._openDocuments[documentID],
                lazy = payload.lazy,
                nextLayers = document.layers.resetLayers(layerObjs, document, lazy),
                nextDocument = document.set("layers", nextLayers),
                suppressDirty = payload.suppressDirty;

            this.setDocument(nextDocument, !suppressDirty);
        },

        /**
         * Reset the given layer bounds models.
         *
         * @private
         * @param {{documentID: number, layers: Immutable.Iterable.<{layerID: number, descriptor: object}>}} payload
         */
        _handleBoundsReset: function (payload) {
            var documentID = payload.documentID,
                boundsObjs = payload.bounds,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.resetBounds(boundsObjs),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Reset the given layer models based on index in the tree
         *
         * @private
         * @param {{documentID: number, descriptors: Array.<ActionDescriptor>}} payload
         */
        _handleLayerResetByIndex: function (payload) {
            var documentID = payload.documentID,
                descriptors = payload.descriptors,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.replaceLayersByIndex(document, descriptors),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update basic properties (e.g., name, opacity, etc.) of the given layers.
         *
         * @private
         * @param {number} documentID
         * @param {Immutable.List.<number>} layerIDs
         * @param {object} properties
         * @param {boolean=} quiet If true, suppress change event.
         */
        _updateLayerProperties: function (documentID, layerIDs, properties, quiet) {
            var document = this._openDocuments[documentID],
                nextLayers = document.layers.setProperties(layerIDs, properties),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true, quiet);
        },

        /**
         * When a layer visibility is toggled, updates the layer object. Below,
         * layerProps is a map from layer ID to visibility status.
         *
         * @private
         * @param {{documentID: number, layerProps: Immutable.Map.<number, boolean>}} payload
         */
        _handleVisibilityChanged: function (payload) {
            var documentID = payload.documentID,
                document = this._openDocuments[documentID],
                layerProps = payload.layerProps,
                nextLayers = document.layers.setVisibility(layerProps),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * When a layer locking is changed, updates the corresponding layer object
         *
         * @private
         * @param {{documentID: number, layerID: number, locked: boolean}} payload
         */
        _handleLockChanged: function (payload) {
            var documentID = payload.documentID,
                layerID = payload.layerID,
                layerIDs = Immutable.List.of(layerID),
                locked = payload.locked;

            this._updateLayerProperties(documentID, layerIDs, { locked: locked });
        },

        /**
         * Update layer models when groups are expanded or collapsed.
         *
         * @private
         * @param {object} payload
         * @param {number} payload.documentID
         * @param {Immutable.Iterable.<number>} payload.layerIDs
         * @param {boolean} payload.expanded
         * @param {Array.<number>} payload.selected Layer IDs that are newly selected
         * @param {Array.<number>} payload.deselected Layer IDs that are newly deselected
         */
        _handleGroupExpansion: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                expanded = payload.expanded,
                selectedIDs = payload.selected,
                deselectedIDs = payload.deselected,
                suppressChange = true;

            // Suppress the first change event if there will be a second one later
            if (selectedIDs.length === 0 && deselectedIDs.length === 0) {
                suppressChange = false;
            }

            // If there will be a selection change, suppress change event for
            // initial group expansion change.
            this._updateLayerProperties(documentID, layerIDs, { expanded: expanded },
                suppressChange);

            if (!suppressChange) {
                // A change event has already been emitted, and there are no
                // further selection changes.
                return;
            }

            // Calculate the updated layer selection
            var nextDocument = this._openDocuments[documentID],
                deselectedIDSet = new Set(deselectedIDs),
                nextSelectedIDs = nextDocument.layers.selected
                    .map(function (layer) {
                        return layer.id;
                    })
                    .filterNot(function (layerID) {
                        return deselectedIDSet.has(layerID);
                    })
                    .concat(selectedIDs)
                    .toSet();

            // Trigger change event with the final selection change
            this._updateLayerSelection(nextDocument, nextSelectedIDs);
        },

        /**
         * Update the layer opacity, as a percentage in [0, 100].
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, opacity: number}} payload
         */
        _handleOpacityChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                opacity = payload.opacity;

            this._updateLayerProperties(documentID, layerIDs, { opacity: opacity });
        },

        /**
         * Update the layer blendMode.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, mode: string}} payload
         */
        _handleBlendModeChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                mode = payload.mode;

            this._updateLayerProperties(documentID, layerIDs, { blendMode: mode });
        },

        /**
         * Rename the given layer in the given document.
         *
         * @private
         * @param {{documentID: number, layerID: number, newName: string}} payload
         */
        _handleLayerRenamed: function (payload) {
            var documentID = payload.documentID,
                layerID = payload.layerID,
                layerIDs = Immutable.List.of(layerID),
                name = payload.name;

            this._updateLayerProperties(documentID, layerIDs, { name: name });
        },

        /**
         * Update the "exportEnabled" flag for a set of layers
         *
         * @param {{documentID: number, layerIDs: Immutable.Iterable.<number>, exportEnabled: boolean}} payload
         */
        _handleExportEnabledChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                exportEnabled = payload.exportEnabled;

            this._updateLayerProperties(documentID, layerIDs, { exportEnabled: exportEnabled });
        },

        /**
         * Remove the deleted layers from our model and update the order
         *
         * @private
         * @param {{documentID: number, layerIDs: Immutable.List<number>, selectedIndices: Array.<number>=}} payload
         */
        _handleDeleteLayers: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                document = this._openDocuments[documentID],
                updatedLayers = document.layers.deleteLayers(layerIDs),
                nextDocument = document.set("layers", updatedLayers);

            this.setDocument(nextDocument, true);

            if (payload.selectedIndices) {
                this._updateLayerSelectionByIndices(nextDocument, Immutable.Set(payload.selectedIndices));
            }
        },

        /**
         * Create a new group layer in the given document that contains the
         * currently selected layers.
         *
         * @private
         */
        _handleGroupLayers: function (payload) {
            var documentID = payload.documentID,
                groupID = payload.groupID,
                groupEndID = payload.groupEndID,
                groupName = payload.groupname,
                isArtboard = payload.isArtboard,
                bounds = payload.bounds,
                suppressChange = payload.suppressChange;

            var document = this._openDocuments[documentID],
                updatedLayers = document.layers.createGroup(documentID, groupID, groupEndID, groupName,
                    isArtboard, bounds),
                nextDocument = document.set("layers", updatedLayers);

            this.setDocument(nextDocument, true, suppressChange);
        },

        /**
         * Payload contains the array of layer IDs after reordering,
         * Sends it to layertree model to rebuild the tree
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>}} payload
         *
         */
        _handleUngroupLayers: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                selectedIDs = payload.selectedIDs,
                document = this._openDocuments[documentID],
                reorderedLayers = document.layers.updateOrder(layerIDs),
                selectedLayers = reorderedLayers.updateSelection(selectedIDs),
                nextDocument = document.set("layers", selectedLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Payload contains the array of layer IDs after reordering, and the selected indexes
         * Sends it to layertree model to rebuild the tree
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, selectedIndices: Array.<number>}} payload
         *
         */
        _handleLayerReorder: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                document = this._openDocuments[documentID],
                reorderLayers = document.layers.updateOrder(layerIDs),
                selectedIDs = Immutable.Set(payload.selectedIndices.map(function (index) {
                    return reorderLayers.byIndex(index + 1).id;
                })),
                nextLayers = reorderLayers.updateSelection(selectedIDs),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Helper function to change layer selection given a Set of selected IDs.
         *
         * @private
         * @param {Document} document
         * @param {Immutable.Set<number>} selectedIDs
         * @param {?number} pivotID
         */
        _updateLayerSelection: function (document, selectedIDs, pivotID) {
            var nextLayers = document.layers.updateSelection(selectedIDs, pivotID),
                nextDocument = document.set("layers", nextLayers);

            // layer selection should NOT dirty the document
            this.setDocument(nextDocument, false);
        },

        /**
         * Helper function to change layer selection given a Set of selected indexes.
         *
         * @private
         * @param {Document} document
         * @param {Immutable.Set<number>} selectedIndices
         */
        _updateLayerSelectionByIndices: function (document, selectedIndices) {
            var selectedIDs = selectedIndices.map(function (index) {
                return document.layers.byIndex(index + 1).id;
            });

            this._updateLayerSelection(document, selectedIDs, null);
        },

        /**
         * Update selection state of layer models, referenced by id.
         *
         * @private
         * @param {{documentID: number, selectedIDs: Array.<number>}} payload
         */
        _handleLayerSelectByID: function (payload) {
            var document = this._openDocuments[payload.documentID],
                selectedIDs = Immutable.Set(payload.selectedIDs),
                pivotID = payload.hasOwnProperty("pivotID") ? payload.pivotID : null;

            this._updateLayerSelection(document, selectedIDs, pivotID);
        },

        /**
         * Update selection state of layer models, referenced by index.
         *
         * @private
         * @param {{documentID: number, selectedIndices: Array.<number>}} payload
         */
        _handleLayerSelectByIndex: function (payload) {
            var document = this._openDocuments[payload.documentID],
                selectedIndices = Immutable.Set(payload.selectedIndices);

            this._updateLayerSelectionByIndices(document, selectedIndices);
        },

        /**
         * Update the bounds of affected layers
         *
         * @private
         * @param {{documentID: number, positions: Array.<{layer: Layer, x: number, y: number}>}} payload
         */
        _handleLayerRepositioned: function (payload) {
            var documentID = payload.documentID,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.repositionLayers(payload.positions),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update the bounds of affected layers
         *
         * @private
         * @param {{documentID: number, sizes: object}} payload
         * @param {Array.<{layer: Layer, w: number, h: number, x: number, y: number}>} payload.sizes
         */
        _handleLayerResized: function (payload) {
            var documentID = payload.documentID,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.resizeLayers(payload.sizes),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update the proportional flag of affected layers
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, propotional: bool}} payload
         */
        _handleSetLayersProportional: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                proportional = payload.proportional,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setLayersProportional(layerIDs, proportional),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Set the radii for the given layers in the given document. NOTE: This
         * only emits a "radiiChange" event instead of a general-purpose "change"
         * event.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, radii: object}} payload
         */
        _handleRadiiChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                radii = payload.radii,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setBorderRadii(layerIDs, radii),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true, false, "radiiChange");
        },

        /**
         * Update the provided properties of all fills of given index of the given layers of the given document
         * example payload {documentID:1, layerIDs:[1,2], fillIndex: 0, fillProperties:{opacity:1}}
         *
         * expects payload like
         *     {
         *         documentID: number,
         *         layerIDs: Array.<number>,
         *         fillProperties: object
         *     }
         *
         * @private
         * @param {object} payload
         */
        _handleFillPropertiesChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                fillProperties = payload.fillProperties,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setFillProperties(layerIDs, fillProperties),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update the provided properties of all strokes of given index of the given layers of the given document
         * example payload {documentID:1, layerIDs:[1,2], strokeProperties:{width:12}}
         *
         * expects payload like
         *     {
         *         documentID: number,
         *         layerIDs: Array.<number>,
         *         strokeProperties: object
         *     }
         *
         * @private
         * @param {object} payload
         */
        _handleStrokePropertiesChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                strokeProperties = payload.strokeProperties,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setStrokeProperties(layerIDs, strokeProperties),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Adds a stroke to the specified document and layers
         * This also handles updating strokes where we're refetching from Ps
         *
         * @private
         * @param {{documentID: !number, strokeStyleDescriptor: object}} payload
         */
        _handleStrokeAdded: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                strokeStyleDescriptor = payload.strokeStyleDescriptor,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.addStroke(layerIDs, strokeStyleDescriptor),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update the provided properties of all layer effects of given index of the given layers of the given document
         *
         * example payload:
         * {
         *     documentID: 1,
         *     layerIDs:[ 1,2],
         *     layerEffectIndex: 0,
         *     layerEffectType: "dropShadow",
         *     layerEffectProperties: {blur: 12}
         * }
         *
         * @private
         * @param {object} payload
         */
        _handleLayerEffectPropertiesChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                layerEffectIndex = payload.layerEffectIndex,
                layerEffectType = payload.layerEffectType,
                layerEffectProperties = payload.layerEffectProperties,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setLayerEffectProperties(
                    layerIDs, layerEffectIndex, layerEffectType, layerEffectProperties),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Updates the properties of all provided layers for all their effects
         *
         * @private
         * @param {object} payload Event payload
         * @param {Immutable.List<String>} payload.layerEffectTypes list of fx types
         * @param {Immutable.Map<String, Immutable.List<Immutable.List<number>>>} payload.layerEffectIndex
         *                                    types mapped to indices in layerIDs mapped to effect indices
         * @param {Immutable.Map<String, Immutable.List<Immutable.List<object>>>} payload.layerEffectProps
         *                                    types mapped to indices in layerIDs mapped to effect objects
         * @param {Immutable.List<number>} payload.layerIDs
         * @param {number} payload.documentID
         */
        _handleLayerEffectsBatch: function (payload) {
            var documentID = payload.documentID,
                document = this._openDocuments[documentID],
                layerIDs = payload.layerIDs,
                effectTypes = payload.layerEffectTypes,
                effectIndex = payload.layerEffectIndex,
                effectProps = payload.layerEffectProps,

                nextLayers = document.layers.withMutations(function (model) {
                    effectTypes.forEach(function (type) {
                        // Immutable.Map<ID, Immutable.List> for layerID to indices and props
                        var layerEffectPropsList = effectProps.get(type),
                            layerEffectIndexList = effectIndex.get(type);

                        if (layerEffectPropsList.isEmpty()) {
                            model = model.deleteAllLayerEffects(layerIDs, type);
                        } else {
                            layerEffectPropsList.forEach(function (props, index) {
                                var indices = layerEffectIndexList.get(index);

                                model = model.setLayerEffectProperties(layerIDs, indices, type, props);
                            });
                        }
                    });
                    return model;
                }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Delete the selected layer effects of selected layers of the given document
         *
         * example payload:
         * {
         *     documentID: 1,
         *     layerIDs:[ 1,2],
         *     layerEffectIndex: 0,
         *     layerEffectType: "dropShadow",
         * }
         *
         * @private
         * @param {object} payload
         */
        _handleDeletedLayerEffect: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                layerEffectIndex = payload.layerEffectIndex,
                layerEffectType = payload.layerEffectType,
                document = this._openDocuments[documentID];

            var nextLayers = document.layers.deleteLayerEffectProperties(layerIDs, layerEffectIndex, layerEffectType),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update text styles when the typeface used in text layers changes.
         * NOTE: Assumes that each layer now only has a single text style,
         * and adjusts the model accordingly.
         *
         * @private
         * @param {object} payload
         * @param {number} payload.documentID
         * @param {Array.<number>} payload.layerIDs
         * @param {string} payload.family
         * @param {string} payload.stype
         * @param {string} payload.postscript
         */
        _handleTypeFaceChanged: function (payload) {
            var family = payload.family,
                style = payload.style,
                fontStore = this.flux.store("font"),
                postScriptName = fontStore.getPostScriptFromFamilyStyle(family, style);

            if (!postScriptName) {
                postScriptName = payload.postscript;
            }

            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setCharacterStyleProperties(layerIDs, { postScriptName: postScriptName }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update text styles when the type size used in text layers changes.
         * NOTE: Assumes that each layer now only has a single text style,
         * and adjusts the model accordingly.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, size: number}} payload
         */
        _handleTypeSizeChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                size = payload.size,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setCharacterStyleProperties(layerIDs, { textSize: size }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update text styles when the type color used in text layers changes.
         * NOTE: Assumes that each layer now only has a single text style,
         * and adjusts the model accordingly.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, color: Color|null}} payload
         */
        _handleTypeColorChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                color = payload.color,
                opaqueColor = null,
                opacity = null,
                ignoreAlpha = payload.ignoreAlpha,
                document = this._openDocuments[documentID];

            if (color !== null) {
                opaqueColor = color.opaque();
                opacity = color.opacity;
            }
            
            var nextLayers = document.layers.setCharacterStyleProperties(layerIDs, {
                color: opaqueColor
            });

            if (!ignoreAlpha) {
                nextLayers = nextLayers.setProperties(layerIDs, {
                    opacity: opacity
                });
            }

            var nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update text styles when the type tracking used in text layers changes.
         * NOTE: Assumes that each layer now only has a single text style,
         * and adjusts the model accordingly.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, tracking: number}} payload
         */
        _handleTypeTrackingChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                tracking = payload.tracking,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setCharacterStyleProperties(layerIDs, { tracking: tracking }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update text styles when the type leading used in text layers changes.
         * NOTE: Assumes that each layer now only has a single text style,
         * and adjusts the model accordingly.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, leading: number}} payload
         */
        _handleTypeLeadingChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                leading = payload.leading,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setCharacterStyleProperties(layerIDs, { leading: leading }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update paragraph styles when the alignment used in text layers changes.
         * NOTE: Assumes that each layer now only has a single text style,
         * and adjusts the model accordingly.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, alignment: string}} payload
         */
        _handleTypeAlignmentChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                alignment = payload.alignment,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setParagraphStyleProperties(layerIDs, { alignment: alignment }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Update any character or paragraph style properties.
         * TODO: Ideally, this would subsume all the other type property change handlers.
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, alignment: string}} payload
         */
        _handleTypePropertiesChanged: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                document = this._openDocuments[documentID],
                properties = payload.properties,
                paragraphProperties = {},
                characterProperties = {};

            Object.keys(properties).forEach(function (property) {
                switch (property) {
                case "textSize":
                case "postScriptName":
                case "color":
                case "tracking":
                case "leading":
                    characterProperties[property] = properties[property];
                    break;
                case "alignment":
                    paragraphProperties[property] = properties[property];
                    break;
                default:
                    throw new Error("Unexpected type property: " + property);
                }
            });

            var nextLayers = document.layers
                    .setCharacterStyleProperties(layerIDs, characterProperties)
                    .setParagraphStyleProperties(layerIDs, paragraphProperties),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Updates the overall guides information of the document
         *
         * @private
         * @param {{document: Document=, documentID: number=, guides: Array.<object>}} payload
         */
        _handleGuidesUpdated: function (payload) {
            var document = payload.document || this._openDocuments[payload.documentID],
                guideDescriptors = payload.guides,
                nextGuides = Guide.fromDescriptors(document, guideDescriptors),
                nextDocument = document.set("guides", nextGuides);

            this.setDocument(nextDocument);
        },

        /**
         * Updates a guide with new information, or creates a new guide
         * 
         * @private
         * @param {{documentID: number, index: number, guide: object}} payload
         */
        _handleGuideSet: function (payload) {
            var documentID = payload.documentID,
                index = payload.index,
                document = this._openDocuments[documentID],
                guide = payload.guide,
                orientation = guide.orientation,
                position = guide.position;

            var nextGuide = document.guides.get(index);

            if (nextGuide) {
                nextGuide = nextGuide.merge({
                    orientation: orientation,
                    position: position
                });
            } else {
                var layerID = guide.layerID,
                    isDocumentGuide = guide.isDocumentGuide,
                    model = {
                        documentID: documentID,
                        orientation: orientation,
                        position: position,
                        isDocumentGuide: isDocumentGuide,
                        layerID: layerID
                    };
                
                nextGuide = new Guide(model);
            }

            var nextDocument = document.setIn(["guides", index], nextGuide);

            this.setDocument(nextDocument, true);
        },

        /**
         * Deletes the guide at the given index
         * 
         * @private
         * @param {{documentID: number, index: number}} payload
         */
        _handleGuideDeleted: function (payload) {
            var documentID = payload.documentID,
                index = payload.index,
                document = this._openDocuments[documentID];

            var nextDocument = document.deleteIn(["guides", index]);

            this.setDocument(nextDocument, true);
        },

        /**
         * Clears all the guides
         *
         * @private
         * @param {{documentID: number}} payload
         */
        _handleGuidesCleared: function (payload) {
            var documentID = payload.documentID,
                document = this._openDocuments[documentID];

            var nextDocument = document.set("guides", Immutable.List());

            this.setDocument(nextDocument, true);
        },
        
        /**
         * Update layer with the correct vector mask property
         *
         * @private
         * @param {{documentID: number, layerIDs: Array.<number>, vectorMaskEnabled: boolean}} payload
         */
        _handleVectorMask: function (payload) {
            var documentID = payload.documentID,
                layerIDs = payload.layerIDs,
                vectorMaskEnabled = payload.vectorMaskEnabled,
                document = this._openDocuments[documentID],
                nextLayers = document.layers.setProperties(layerIDs, { vectorMaskEnabled: vectorMaskEnabled }),
                nextDocument = document.set("layers", nextLayers);

            this.setDocument(nextDocument, true);
        },

        /**
         * Add Layer state listener.
         * 
         * @param {number} layerID
         * @param {Function} callback
         */
        addLayerStateListener: function (layerID, callback) {
            this._layerIDToStateListener[layerID] = callback;
        },
        
        /**
         * Remove Layer state listener.
         * 
         * @param {number} layerID
         */
        removeLayerStateListener: function (layerID) {
            this._layerIDToStateListener[layerID] = null;
        }
    });

    module.exports = DocumentStore;
});
