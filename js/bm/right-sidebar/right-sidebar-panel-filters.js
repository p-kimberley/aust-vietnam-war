/**
 * Provides filters for working with contacts
 * @extends {BM.RightSidebarPanel}
 * @constructor
 */
BM.RightSidebarPanel.Filters = function () {
	BM.RightSidebarPanel.call(this, 'filters', '#right-sidebar-button-filters', '#right-sidebar-panel-filters', true);

	/** @type {BM.FilterController} */
	this.contactFilterController = new BM.FilterController($('#contact-filter-container'));
	this.sortieFilterController = new BM.FilterController($('#sortie-filter-container'));
	this.navalGunfireFilterController = new BM.FilterController($('#naval-gunfire-filter-container'));

	/** @type {BM.FilterController} */
	this.currentFilterController = undefined;
};

BM.RightSidebarPanel.Filters.prototype = Object.create(BM.RightSidebarPanel.prototype);
BM.RightSidebarPanel.Filters.prototype.constructor = BM.RightSidebarPanel.Filters;

BM.RightSidebarPanel.Filters.prototype.init = function (callback) {
	var self = this;

	this.loadContactFilters(function () {
		self.loadSortieFilters(function() {
			self.loadNavalGunfireFilters(function() {
				$('body').on('bm:layer.enabled', function(event) {
					/**
					 * @type BM.Layer
					 */
					var layer = event.layer;
					this.currentFilterController = undefined;

					switch(layer.type)
					{
						case BM.LayerType.contact.individual:
							self.currentFilterController = self.contactFilterController;
							break;
						case BM.LayerType.contact.airSorties:
							self.currentFilterController = self.sortieFilterController;
							break;
						case BM.LayerType.contact.navalFireMissions:
							self.currentFilterController = self.navalGunfireFilterController;
							break;
					}

					if (self.currentFilterController)
						self.currentFilterController.setVisibility(event.enabled);
				});

				callback();
			});
		});
	});
};

/**
 * @param callback
 * @protected
 */
BM.RightSidebarPanel.Filters.prototype.loadContactFilters = function (callback) {
	var self = this;

	// Load contact range information from the database. These are constant values used to set bounds for the filter UI
	$.ajax({
		url: '/api/es/search/avw_nomroll',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"aggs": {
				"fr_strength": {
					"stats": {
						"field": "Fr_Force_Present"
					}
				},
				"fr_cas": {
					"stats": {
						"field": "Total_Fr_Cas"
					}
				},
				"en_strength": {
					"stats": {
						"field": "Total_En_Cas"
					}
				},
				"en_cas": {
					"stats": {
						"field": "Total_En_Cas"
					}
				}
			}
		})
	}).done(function (data) {
		var aggs = data.aggregations;

		self.contactFilterController
			.addFilter(new BM.Filter.SingleSelectList(BM.FilterID.contact.dataSource, 'Data Source', 'Series', {
				quoteValue: true,
				nameValueArray: [{
					name: '1st Australian Task Force',
					value: '1ATF'
				}, {
					name: '1 RAR Battalion Group',
					value: '1RAR'
				}]
			}));

		var unitTreeFilter = new BM.Filter.UnitTree(BM.FilterID.contact.unitsInvolved, 'Units Involved', 'Fr_Units.ID', function () {
			var operationsFilter = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.contact.operationName, 'Operation Name', 'avw_contacts', 'Operation', 0, function () {
				var unitTaskFilter = new BM.Filter.DistinctFieldSingleSelect(BM.FilterID.contact.unitTask, 'Unit Task', 'avw_contacts', 'Unit_Task', 10, function () {
					self.contactFilterController
						.addFilter(unitTreeFilter)
						.addFilter(operationsFilter)
						.addFilter(unitTaskFilter)
						.addFilter(new BM.Filter.RangeSlider(BM.FilterID.contact.hourOfDay, 'Hour of Day', 'Hour', 0, 23))
						.addFilter(new BM.Filter.RangeSlider(BM.FilterID.contact.friendlyStrength, 'Friendly Strength', 'Fr_Force_Present', aggs.fr_strength.min, aggs.fr_strength.max))
						.addFilter(new BM.Filter.RangeSlider(BM.FilterID.contact.friendlyCas, 'Friendly Casualties', 'Total_Fr_Cas', aggs.fr_cas.min, aggs.fr_cas.max))
						.addFilter(new BM.Filter.RangeSlider(BM.FilterID.contact.enemyStrength, 'Enemy Strength', 'En_Force', aggs.en_strength.min, aggs.en_strength.max))
						.addFilter(new BM.Filter.RangeSlider(BM.FilterID.contact.enemyCas, 'Enemy Casualties', 'Total_En_Cas', aggs.en_cas.min, aggs.en_cas.max))
						.addFilter(new BM.Filter.SingleSelectList(BM.FilterID.contact.type, 'Mine Incident', 'Mine_Incid', {
							quoteValue: false,
							nameValueArray: [{
								name: 'Yes',
								value: 1
							}, {
								name: 'No',
								value: 0
							}]
						}))
						.addFilter(new BM.Filter.TextBox(BM.FilterID.contact.description, 'Incident Description', 'Description_of_Incident', 25, 'Enter a word or phrase'))
						.addFilter(new BM.Filter.IncidentNotes('Incident Notes'));

					if (callback)
						callback();
				});
			});
		});
	}).fail(function () {
		InfoDialog("Error", "Incident filter data could not be retrieved.<br><br>Please check your network connection and refresh the page.");
	});
};

/**
 * @param callback
 * @protected
 */
BM.RightSidebarPanel.Filters.prototype.loadSortieFilters = function (callback) {
	var self = this;

	$.ajax({
		url: '/api/es/search/air_operations',
		method: 'POST',
		dataType: 'json',
		contentType: 'application/json',
		data: JSON.stringify({
			"size": 0,
			"query": {
				"bool": {
					"filter": {
						"exists": {
							"field": "Target.Location"
						}
					}
				}
			},
			"aggs": {
				"num_aircraft": {
					"stats": {
						"field": "Sortie_Num_Aircraft"
					}
				}
			}
		})
	}).done(function (data) {
		var aggs = data.aggregations;

		self.contactFilterController
			.addFilter(new BM.Filter.SingleSelectList(BM.FilterID.sortie.dataSource, 'Data Source', 'Source_Dataset', {
				quoteValue: true,
				nameValueArray: [{
					name: 'CACTA',
					value: 'CACTA'
				}, {
					name: 'SEADAB',
					value: 'SEADAB'
				}]
			}));

		var msnFunc = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.msnFunc, 'Mission Function', 'air_operations', 'Msn_Func', 0, function () {
			var serviceSupported = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.serviceSupported, 'Service Supported', 'air_operations', 'Service_Supported', 0, function () {
				var opSupported = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.opSupported, 'Operation Supported', 'air_operations', 'Op_Supported', 0, function () {
					var countryOrigin = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.countryOrigin, 'Country of Origin', 'air_operations', 'Country_Origin', 0, function () {
						var launchBase = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.launchBase, 'Launch Base', 'air_operations', 'Launch_Base.Name', 0, function () {
							var aircraftType = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.aircraftType, 'Aircraft Type', 'air_operations', 'Aircraft.Type', 0, function () {
								var timeOfDay = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.timeOfDay, 'Time of Day', 'air_operations', 'Target.Time_of_Day', 0, function () {
									var targetObjective = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.sortie.targetObj, 'Target Objective', 'air_operations', 'Target.Objective', 0, function () {
										self.sortieFilterController
											.addFilter(msnFunc)
											.addFilter(serviceSupported)
											.addFilter(opSupported)
											.addFilter(countryOrigin)
											.addFilter(launchBase)
											.addFilter(aircraftType)
											.addFilter(new BM.Filter.RangeSlider(BM.FilterID.sortie.numAircraft, 'Number of Aircraft in Sortie', 'Sortie_Num_Aircraft', aggs.num_aircraft.min, aggs.num_aircraft.max))
											.addFilter(timeOfDay)
											.addFilter(targetObjective);

										if (callback)
											callback();
									})
								})
							})
						})
					})
				})
			})
		});
	}).fail(function () {
		InfoDialog("Error", "Sortie filter data could not be retrieved.<br><br>Please check your network connection and refresh the page.");
	});
};

/**
 * @param callback
 * @protected
 */
BM.RightSidebarPanel.Filters.prototype.loadNavalGunfireFilters = function (callback) {
	var self = this;

	var shipType = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.shipType, 'Ship type', 'conga', 'Ship.Type', 0, function () {
		var shipName = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.shipName, 'Ship name', 'conga', 'Ship.Name', 0, function () {
			var opName = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.operationName, 'Operation name', 'conga', 'Operation_Name', 0, function () {
				var opType = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.operationType, 'Operation type', 'conga', 'Operation_Type', 0, function () {
					var forceSupported = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.forceSupported, 'Force supported', 'conga', 'Force_Supported', 0, function () {
						var corpsArea = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.targetCorpsArea, 'Target corps area', 'conga', 'Target.Corps_Area', 0, function () {
							var targetType = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.targetType, 'Target type', 'conga', 'Target.Type', 0, function () {
								var timeOfDay = new BM.Filter.DistinctFieldMultiSelect(BM.FilterID.navalGunfire.timeOfDay, 'Time of day', 'conga', 'Time_of_Day', 0, function () {
									self.navalGunfireFilterController
										.addFilter(shipType)
										.addFilter(shipName)
										.addFilter(opName)
										.addFilter(opType)
										.addFilter(forceSupported)
										.addFilter(corpsArea)
										.addFilter(targetType)
										.addFilter(timeOfDay);

									if (callback)
										callback();
								})
							})
						})
					})
				})
			})
		})
	});
};

/**
 * Generates a filter string based on the selected filter control values and re-filters the map contacts
 * @param {BM.FilterController} filterController - The filter controller this applies to
 * @param {boolean} [resetTimeline] - Whether to reset the date range of the Timeline, assuming the new datamin/datamax values
 * @param [callback]
 * @protected
 */
BM.RightSidebarPanel.Filters.prototype.applyFilter = function (filterController, resetTimeline, callback) {
	this.contactFilterController.deactivateAllFilterControls();
	BM.LoadingProgress.init('Updating map layers', '', true);
	BM.LoadingProgress.show(function () {
		// Refresh contact data, to enable generation of contact layers
		BM.ActivityLogging.logEvent(BM.LogEventTypes.appliedFilter, null, filterController.serialiseState());
		BM.StateManagement.replaceState();
		BM.LoadingProgress.hide();

		if (callback)
			callback();
	});
};

BM.RightSidebarPanel.Filters.prototype.applyContactFilter = function (resetTimeline, callback) {
	this.applyFilter(this.contactFilterController, callback);
	$('body').trigger(new $.Event('bm:contact-filter.changed'));
};

BM.RightSidebarPanel.Filters.prototype.applySortieFilter = function (resetTimeline, callback) {
	this.applyFilter(this.sortieFilterController, callback);
	$('body').trigger(new $.Event('bm:sortie-filter.changed'));
};

BM.RightSidebarPanel.Filters.prototype.applyNavalGunfireFilter = function (resetTimeline, callback) {
	this.applyFilter(this.navalGunfireFilterController, callback);
	$('body').trigger(new $.Event('bm:naval-gunfire-filter.changed'));
};

/**
 * Clears all filters
 * @param {BM.FilterController} filterController
 * @param callback
 * @protected
 */
BM.RightSidebarPanel.Filters.prototype.clearFilter = function (filterController, callback) {
	filterController.clearAllFilters();
	BM.Timeline.pause();
	this.applyFilter(filterController, true, function () {
		BM.Timeline.resetDateRange();
		if (callback)
			callback();
	});
};

BM.RightSidebarPanel.Filters.prototype.clearContactFilter = function (callback) {
	this.clearFilter(this.contactFilterController, callback);
	$('body').trigger(new $.Event('bm:contact-filter.changed'));
};

BM.RightSidebarPanel.Filters.prototype.clearSortieFilter = function (callback) {
	this.clearFilter(this.sortieFilterController, callback);
	$('body').trigger(new $.Event('bm:sortie-filter.changed'));
};

BM.RightSidebarPanel.Filters.prototype.clearNavalGunfireFilter = function (callback) {
	this.clearFilter(this.navalGunfireFilterController, callback);
	$('body').trigger(new $.Event('bm:naval-gunfire-filter.changed'));
};