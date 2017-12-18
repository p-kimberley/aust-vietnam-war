var BM = BM || {};

/**
 * Redirects the user to the login page and return to this location afterwards
 */
function RedirectToLoginPage()
{
	$('#dialog-login').dialog({
		modal: true,
		show: {
			effect: 'fade',
			duration: 300
		},
		hide: {
			effect: 'fade',
			duration: 300
		},
		width: 350,
		title: "Sign-In Required",
		open: function() {
			$(this).siblings('.ui-dialog-buttonpane').find('button').eq(1).focus();
		},
		buttons: [{
			text: "Cancel",
			click: function () {
				$(this).dialog('close');
			}
		},{
			text: "Login",
			class: 'default',
			click: function() {
				window.location = GetLoginPageURL();
			}
		}]
	});
}

/**
 * @returns {string}
 */
function GetLoginPageURL()
{
	return '/wp-login.php?redirect_to=' + encodeURIComponent(window.location.href);
}

// Pads a number with leading zeroes to a defined total number of digits
function Pad(number, length)
{
    var str = number.toString();
    while (str.length < length)
    {
        str = '0' + str;
    }

    return str;
}

/**
 * Replaces a numeric string that contains null or is empty, with a '0'
 * @return {string}
 */
function Nz(numericString)
{
    if (numericString == null || numericString == "")
        return "0";
    else if (String(numericString).toLowerCase() == "null")
        return "0";
    else
        return numericString;
}

function RetrieveWPUserProfileFields(fnCallback)
{
    $.get('/php/bm/get-current-user.php', function (data)
    {
        BM.currentWPUser = $.parseJSON(data);

        if (fnCallback)
            fnCallback();
    });
}

// Shows a DIV above screen elements to dim the screen and prevent user interaction
// Used by loading status popups
function DoModal(modalEnabled, callback)
{
	if (modalEnabled)
		$('#modal-background').fadeIn(300);
    else
		$('#modal-background').fadeOut(300);

    if (callback)
        callback();
}

// Sets the opacity of the modal background
// Used at initial load to hide screen elements while they are being initialised
function SetModalBackgroundOpacity(opacity)
{
    $('#modal-background').css('opacity', opacity);
}

/**
 * Displays a small spinner in the specified container element
 * @param {jQuery} container
 */
function DisplayTinyLoadingIndicator(container)
{
	if (container)
		container.spin(BM.options.tinySpinner);
}

/**
 * @param {jQuery} container
 */
function HideTinyLoadingIndicator(container)
{
	if (container)
		container.spin(false);
}

/**
 * Appends a loading indicator to an element to give visual feedback while background operations are occurring.
 * Call HideLoadingIndicator() before rendering is conducted
 * @param {jQuery} container
 * @param {string} text
 * @param {string} [foreColour] - Override foreground colour
 * @param {string} [backColour] - Background to use for overlay. Can be used to obscure underlying elements while spinner is active
 */
function DisplayLoadingIndicator(container, text, foreColour, backColour)
{
    if (!container)
        return;

    // Remove any existing loading indicators from the container
    container.children('.loading-container').remove();

    // Insert the loading indicator
	var loadingContainer = $(document.createElement('div'))
		.addClass('loading-container')
		.hide();

	var cssColor = 'color: ' + foreColour ? foreColour : 'inherit';
	var cssBackgroundColor = 'background-color: ' + backColour ? backColour : 'transparent';

	loadingContainer.append(
		'<div class="loading-container-inner">' +
			'<div class="loading-spinner"></div>' +
			'<div class="loading-text" style="' + cssColor + ';' + cssBackgroundColor + '">' + text + '</div>' +
		'</div>');

    container.prepend(loadingContainer);

    var options = BM.options.spinner;

	if (foreColour)
	{
		$.extend(options, BM.options.spinner);
		options.color = foreColour;
	}

    loadingContainer.find('.loading-spinner').spin(options);
    loadingContainer.fadeIn(400);
}

function HideLoadingIndicator(container)
{
    if (container)
    {
        var loadingContainer = container.children('.loading-container');
        loadingContainer.fadeOut(400);
        loadingContainer.find('.loading-spinner').spin(false);
        loadingContainer.remove();
    }
}

/*
 Pulsate the specified jQueryUI button to draw attention to it
 Parameters:
 uiButton - Target jQueryUI button
 enableEffect - Boolean that enables (TRUE) or stops (FALSE) the effect
 */
function PulseButton(uiButton, enableEffect)
{
    if (uiButton)
    {
        if (enableEffect)
        {
            uiButton.addClass('ui-state-highlight', 1000, 'linear', function ()
            {
                uiButton.removeClass('ui-state-highlight', 1000, 'linear', function ()
                {

                });
            });
        }
    }
}

/**
 * Displays a modal dialog with a single close button
 * @param {string} title
 * @param {string} message
 * @param [callback]
 */
function InfoDialog(title, message, callback)
{
    $('#spinner, #spinner-background').hide();
    $('#dialog-error').dialog({
        modal: true,
        show: {
            effect: 'fade',
            duration: 300
        },
        hide: {
            effect: 'fade',
            duration: 300
        },
		open: function() {
			$(this).siblings('.ui-dialog-buttonpane').find('button').eq(0).focus();
		},
        close: function() {
            if (callback)
                callback();
        },
        width: 400,
        title: title,
        buttons: [{
            text: "Close",
			class: 'default',
            click: function () {
                $(this).dialog('close');
            }
        }]
    }).html("<p>" + message + "</p>");
}

// Enables or disables AJAX cache to cater for certain scenarios where cache is not wanted (i.e. retrieving list of incident notes)
function AJAXEnableCaching(enabled)
{
    $.ajaxSetup({cache: enabled});
}

// There is a discrepancy between current coordinates and 1970s MGRS coords - possibly due to magnetic declination.
// Compensate approximately for these using the functions below.
/**
 * @return {number}
 */
function GetCalibratedLatitude(lat)
{
    return Math.round((lat + 0.0030) * 10000) / 10000;
}

/**
 * @return {number}
 */
function GetCalibratedLongitude(lon)
{
    return Math.round((lon - 0.0030) * 10000) / 10000;
}