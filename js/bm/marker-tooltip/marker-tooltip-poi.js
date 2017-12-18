/**
 * Marker tooltip for combat incidents
 * @param {BM.Layer.PointOfInterest} parentLayer - Parent layer for which markers are attached
 * @constructor
 * @extends {BM.MarkerTooltip}
 */
BM.MarkerTooltip.PointOfInterest = function(parentLayer)
{
	BM.MarkerTooltip.call(this, $('#marker-tooltip-poi'), parentLayer);

	this.queryDelay = 0;
	this.overlay.setOffset([0, -35]);
};

BM.MarkerTooltip.PointOfInterest.prototype = Object.create(BM.MarkerTooltip.prototype);
BM.MarkerTooltip.PointOfInterest.prototype.constructor = BM.MarkerTooltip.PointOfInterest;

/**
 * @param {ol.Feature} marker
 */
BM.MarkerTooltip.PointOfInterest.prototype.render = function(marker)
{
	var content = this.element.find('.ol-popup-content');
	var rowType = content.find('.type');
	var rowName = content.find('.name');
	var rowEstablished = content.find('.established');

	var props = marker.getProperties();

	if (props.type && props.type !== "")
	{
		switch(props.type)
		{
			case 'FSB':
				props.type = 'Fire Support Base';
				break;
			case 'FSPB':
				props.type = 'Fire Support Patrol Base';
				break;
		}

		rowType.show().find('td').text(props.type);
	}
	else
	{
		rowType.hide();
	}

	if (props.name && props.name !== "")
		rowName.show().find('td').text(props.name);
	else
		rowName.hide();

	if (props.established && props.established !== "")
		rowEstablished.show().find('td').text(props.established);
	else
		rowEstablished.hide();
};