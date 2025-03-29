/**
 * Tracks a hierarchical unit structure
 * @param {jQuery} targetSelectorContainer
 * @param {jQuery} navigatorDateElement
 * @class
 * @constructor
 * @extends {BM.TimelineTrackType}
 */
BM.TimelineTrackType.Unit = function(targetSelectorContainer, navigatorDateElement) {
	BM.TimelineTrackType.call(this, 'Unit', targetSelectorContainer, navigatorDateElement);

	var self = this;
	this.unitTree = [];			// Array of top-level unit nodes

	this.unitSearchControl = $(document.createElement('input'))
		.addClass('tree-search-textbox')
		.attr('type', 'text')
		.attr('placeholder', 'Search')
		.on('keyup', function(event) {
			if (event.which === 27)
				self.unitSearchControl.val('');

			self.unitTreeControl.jstree(true).search(self.unitSearchControl.val());
		})
		.appendTo(this.targetSelectorContainer);

	this.unitTreeContainer = $(document.createElement('div'))
		.addClass('tree-container')
		.appendTo(this.targetSelectorContainer);

	this.unitTreeControl = $(document.createElement('div'))
		.addClass('tree-view')
		.on('changed.jstree', function(e, data) {
			self.setTrackTarget(data.selected[0]);
		})
		.appendTo(this.unitTreeContainer);

	this.unitTreeContainer.mCustomScrollbar({
		autoHideScrollbar: false,
		scrollInertia: 200,
		mouseWheel: {
			scrollAmount: 100
		},
		theme: 'light-3',
		advanced: {
			updateOnContentResize: true
		}
	});

	// Retrieve the selection options for the track target and populate the list
	this.populateOptions();
};

BM.TimelineTrackType.Unit.prototype = Object.create(BM.TimelineTrackType.prototype);
BM.TimelineTrackType.Unit.prototype.constructor = BM.TimelineTrackType.Unit;

BM.TimelineTrackType.Unit.prototype.getDescription = function()
{
	return this.selectedTarget.displayName;
};

BM.TimelineTrackType.Unit.prototype.populateOptions = function(callback)
{
	var self = this;

	// Load all distinct unit strings into the array on the client for use with the unit filter tooltip
	$.ajax({
		url: '/api/es/search/avw_units',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"aggs": {
				"units": {
					"terms": {
						"field": "Path.raw",
						"size": 999,
						"order": {
							"_term": "asc"
						}
					},
					"aggs": {
						"incident_count": {
							"value_count": {
								"field": "Incidents.ID"
							}
						},
						"fields": {
							"top_hits": {
								"size": 1,
								"_source": {
									"include": ["Title", "LongTypeName", "ShortDisplayName", "Parent", "Incidents.ID", "Incidents.DTG", "Incidents.Location"]
								}
							}
						}
					}
				}
			}
		})
	}).done(function(data) {
		// Parse unit list into a tree structure
		var rootNodes = [];
		var rootNode = undefined;
		var parentNode = undefined;

		var createNode = function(id, displayName, shortDisplayName, parentNode, incidentCount, incidents) {
			return {
				id: id.toString(),
				text: shortDisplayName + " <span class='item-count'>(" + incidentCount.toLocaleString() + ")</span>",
				displayName: displayName,
				shortDisplayName: shortDisplayName,
				parentNode: parentNode,
				incidentCount: incidentCount,
				incidents: incidents,
				children: []
			};
		};

		var updateNodeText = function(node, incidentCount) {
			node.text = node.displayName + " <span class='item-count'>(" + incidentCount.toLocaleString() + ")</span>";
		};

		$.each(data.aggregations.units.buckets, function(i, unit) {
			var fields = unit.fields.hits.hits[0]._source;
			var id = unit.fields.hits.hits[0]._id;
			var parent = fields.Parent;
			var incidentCount = unit.incident_count.value;
			var incidents = fields.Incidents;
			var nodeSeek = undefined;
			var displayName = fields.ShortDisplayName;
			var shortDisplayName = fields.Title;

			if (fields.LongTypeName)
			{
				if (shortDisplayName)
					shortDisplayName += (" " + fields.LongTypeName);
				else
					shortDisplayName = fields.LongTypeName;
			}

			if (!parent)
			{
				if (rootNode)
					rootNodes.push(rootNode);

				rootNode = createNode(id, displayName, shortDisplayName, undefined, incidentCount, incidents);
				parentNode = rootNode;
			}
			else if(parent == parentNode.id)
			{
				// Node is subordinate to the current parent node, so append it
				var newNode = createNode(id, displayName, shortDisplayName, parentNode, incidentCount, incidents);
				parentNode.children.push(newNode);

				// Increment incident count of all parent nodes
				nodeSeek = parentNode;
				while (nodeSeek)
				{
					nodeSeek.incidentCount += incidentCount;
					updateNodeText(nodeSeek, nodeSeek.incidentCount);

					nodeSeek = nodeSeek.parentNode;
				}

				parentNode = newNode;
			}
			else
			{
				nodeSeek = parentNode;
				var parentFound = false;

				// Scan recursively up the tree for this node's parent
				while(nodeSeek)
				{
					if (!parentFound)
					{
						// Check for a root node match
						if (parent == nodeSeek.id)
						{
							var newNode = createNode(id, displayName, shortDisplayName, nodeSeek, incidentCount, incidents);
							nodeSeek.children.push(newNode);
							nodeSeek.incidentCount += incidentCount;
							updateNodeText(nodeSeek, nodeSeek.incidentCount);
							parentNode = newNode;
							parentFound = true;
						}
						else
						{
							// Check this node's children for a match
							$.each(nodeSeek.children, function (i, childNode) {
								if (parent == childNode.id)
								{
									var newNode = createNode(id, displayName, shortDisplayName, childNode, incidentCount, incidents);
									childNode.children.push(newNode);
									childNode.incidentCount += incidentCount;
									updateNodeText(childNode, childNode.incidentCount);

									parentNode = newNode;
									parentFound = true;
									return false;
								}
							});
						}
					}
					else
					{
						nodeSeek.incidentCount += incidentCount;
						updateNodeText(nodeSeek, nodeSeek.incidentCount);
					}

					nodeSeek = nodeSeek.parentNode;
				}
			}
		});

		if (rootNode)
			rootNodes.push(rootNode);

		// Remove parent node references, as these cause recursion errors with jsTree
		var removeParentReference = function(node) {
			$.each(node.children, function(i, child) {
				child.parentNode = undefined;
				removeParentReference(child);
			});

			node.parentNode = undefined;
		};

		$.each(rootNodes, function(i, node) {
			removeParentReference(node);
		});

		self.unitTree = rootNodes;
		self.unitTreeControl.jstree({
			plugins: ["search", "changed"],
			core: {
				data: rootNodes,
				themes: {
					name: "default",
					icons: false,
					dots: false
				},
				expand_selected_onload: false,
				multiple: false
			},
			search: {
				show_only_matches: true,
				show_only_matches_children: true
			}
		});

		self.unitTreeControl.on('ready.jstree', function() {
			if (callback)
				callback();
		});
	});
};

/**
 * Selects a unit by its ID
 * @param {Number} unitId
 * @param {Number} [initialIncidentId] - Start with this incident selected
 */
BM.TimelineTrackType.Unit.prototype.setTrackTarget = function(unitId, initialIncidentId)
{
	this.selectedTarget = this.getUnitNode(unitId);
	if (this.selectedTarget)
	{
		this.unitTreeControl.jstree('deselect_all', true);
		this.unitTreeControl.jstree('close_all');
		this.unitTreeControl.jstree('select_node', this.selectedTarget, true);
		var nodeDOM = this.unitTreeControl.jstree('get_node', this.unitTreeControl, true);
		this.unitTreeContainer.mCustomScrollbar('scrollTo', nodeDOM);
		this.targetChanged();

		if (initialIncidentId)
			this.goToByIncidentId(initialIncidentId, false);
		else
			this.goNext(false);
	}
};

BM.TimelineTrackType.Unit.prototype.getUnitNode = function(id)
{
	var foundNode = undefined;
	var findNode = function(node) {
		if (node.id == id)
		{
			foundNode = node;
			return node;
		}

		for(var i = 0; i < node.children.length; i++)
		{
			var child = node.children[i];
			findNode(child);
		}
	};

	for(var i = 0; i < this.unitTree.length; i++)
	{
		findNode(this.unitTree[i]);
		if (foundNode)
			return foundNode;
	}

	return undefined;
};

BM.TimelineTrackType.Unit.prototype.populateTargets = function()
{
	if (this.selectedTarget)
		this.trackTargets = [this.selectedTarget];
	else
		this.trackTargets = [];
};